import { Checkpoint } from "../utils/Checkpoint";
import { ConvertDateHour } from "../utils/ConvertDateHour";
import { CreatePdf } from "../utils/CreatePdf";
import { progressTracker } from "../utils/ProgressTracker";
import { AccessTokenService } from "./AccessTokenService";
import { HistoryContactService } from "./HistoryContactService"
import { HistoryMessageService } from "./HistoryMessageService";
import { InternalServerError } from "../middlewares/InternalServerError"
import * as dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";

dotenv.config()

const localdir = process.env?.DIR || "./temp/";

// Quantos contatos são processados ao mesmo tempo (API + download de mídias + PDF)
const concurrency = Math.max(1, Number(process.env?.CONCURRENCY) || 4);


/* 
* Called AccessTokenService, HistoryContactService, HistoryMessageService
*
* @Param companyId, clientKey, dateFrom, dateTo
*
* @return object
*/
class HistoryGeneratorService {

  async execute(companyId: string, clientKey: string, dateFrom: string, dateTo: string) {

    // Gera um ID único para este job
    const jobId = crypto.randomUUID().slice(0, 8);

    if (!companyId) {
      throw new InternalServerError("companyId incorrect!")
    }

    if (!clientKey) {
      throw new InternalServerError("clientKey incorrect!");
    }

    if (!dateFrom) {
      throw new InternalServerError("dateFrom incorrect!")

    }

    if (!dateTo) {
      throw new InternalServerError("dateTo incorrect!")
    }

    progressTracker.startJob(jobId, 0, 'Obtendo token de acesso...');

    try {
      return await this.extract(jobId, companyId, clientKey, dateFrom, dateTo);
    } catch (err: any) {
      progressTracker.errorJob(jobId, err?.message || String(err));
      throw err;
    }
  }

  private async extract(jobId: string, companyId: string, clientKey: string, dateFrom: string, dateTo: string) {

    const accessTokenService = new AccessTokenService();

    const token = await accessTokenService.execute(companyId, clientKey);

    if (!token) {
      throw new InternalServerError("Failed generate token");
    }

    const accessToken = token.accessToken;

    progressTracker.updateMessage(jobId, 'Token obtido. Buscando contatos...');

    const historyContactService = new HistoryContactService();

    const historyContact = await historyContactService.execute(accessToken, companyId, dateFrom, dateTo, (page, found) => {
      progressTracker.updateMessage(jobId, `Buscando contatos... página ${page} (${found.toLocaleString('pt-BR')} encontrados)`);
    });

    // Um mesmo contato repetido entre páginas seria processado duas vezes ao mesmo tempo
    const contacts = [...new Map(historyContact.map((contact) => [String(contact.message_id), contact])).values()];

    // Retoma de onde parou: contatos já concluídos numa execução anterior são pulados
    const checkpoint = new Checkpoint(localdir, companyId, dateFrom, dateTo);
    const failuresFile = `${localdir}falhas_${companyId}_${dateFrom}_${dateTo}.log`;
    const pending = contacts.filter((contact) => !checkpoint.has(contact.message_id));
    const totalContacts = contacts.length;

    progressTracker.setTotal(jobId, totalContacts, totalContacts - pending.length);

    const historyMessageService = new HistoryMessageService()

    const convert = new ConvertDateHour();

    const createPdf = new CreatePdf();

    // Gera os PDFs de um contato; retorna false se algum falhou (fica registrado no log de falhas)
    const processContact = async (messageAttendanceId: any) => {
      const historyMessage = await historyMessageService.execute(accessToken, companyId, messageAttendanceId);

      let ok = true;

      for (const item of historyMessage) {

        const year = convert.dateYear(item.firstMessageAt);
        const month = convert.dateMonth(item.firstMessageAt);
        const day = convert.dateDay(item.firstMessageAt);

        const directory = `${localdir}${year}/${month}/${day}/${item.protocol}`;

        // Erro ao montar o PDF é problema do conteúdo desse atendimento: registra e segue,
        // senão a mensagem volta para a fila e trava a extração em loop no mesmo contato.
        // Erros da API (token, rede) continuam subindo e a extração é retomada pelo checkpoint.
        try {
          await fs.promises.mkdir(directory, { recursive: true });
          await createPdf.execute(item, directory);
        } catch (err: any) {
          ok = false;
          const error = err?.message || String(err);
          progressTracker.log(`❌ Falha ao gerar PDF do protocolo ${item.protocol}: ${error}`);
          fs.appendFileSync(
            failuresFile,
            JSON.stringify({ at: new Date().toISOString(), protocol: item.protocol, contactId: item.contactId, directory, error }) + "\n"
          );
        }
      }

      checkpoint.mark(messageAttendanceId.message_id);

      return ok;
    };

    // Processa até `concurrency` contatos ao mesmo tempo. Se um der erro de API, para de pegar
    // novos, espera os que já estão em andamento terminarem (e entrarem no checkpoint) e sobe o erro.
    let next = 0;
    let failure: any = null;

    const worker = async () => {
      while (!failure && next < pending.length) {
        const messageAttendanceId = pending[next++];
        progressTracker.cardStarted(jobId);
        try {
          const ok = await processContact(messageAttendanceId);
          progressTracker.cardFinished(jobId, ok);
        } catch (err) {
          failure = failure || err;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));

    if (failure) {
      throw failure;
    }

    checkpoint.clear();

    if (fs.existsSync(failuresFile)) {
      progressTracker.log(`⚠️ Alguns atendimentos falharam ao gerar PDF. Veja ${failuresFile}`);
    }

    progressTracker.completeJob(jobId, 'Extração finalizada com sucesso!');
    console.log("Finalizado Processamento");

    return { jobId, totalContacts };
  }
}


export { HistoryGeneratorService }