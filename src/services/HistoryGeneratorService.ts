import { Checkpoint } from "../utils/Checkpoint";
import { ConvertDateHour } from "../utils/ConvertDateHour";
import { CreatePdf } from "../utils/CreatePdf";
import { Directory } from "../utils/Directory";
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

    const accessTokenService = new AccessTokenService();

    progressTracker.startJob(jobId, 100, 'Obtendo token de acesso...');

    const token = await accessTokenService.execute(companyId, clientKey);
    console.log(token);


    if (!token) {
      progressTracker.errorJob(jobId, 'Falha ao gerar token');
      throw new InternalServerError("Failed generate token");
    }

    progressTracker.updateProgress(jobId, 5, 'Token obtido. Buscando contatos...');

    const historyContactService = new HistoryContactService();

    const historyContact = await historyContactService.execute(await token.accessToken, companyId, dateFrom, dateTo);

    const totalContacts = historyContact.length;

    // Retoma de onde parou: contatos já concluídos numa execução anterior são pulados
    const checkpoint = new Checkpoint(localdir, companyId, dateFrom, dateTo);
    const failuresFile = `${localdir}falhas_${companyId}_${dateFrom}_${dateTo}.log`;
    const resumed = historyContact.filter((contact) => checkpoint.has(contact.message_id)).length;

    progressTracker.updateProgress(
      jobId,
      10,
      resumed > 0
        ? `${totalContacts} contatos encontrados. Retomando a partir do ${resumed + 1}...`
        : `${totalContacts} contatos encontrados. Iniciando processamento...`
    );

    // Atualiza o total para refletir a quantidade real de trabalho
    const progress = progressTracker.getProgress(jobId);
    if (progress) {
      progress.total = totalContacts;
      progress.current = resumed;
    }

    const historyMessageService = new HistoryMessageService()

    const dir = new Directory();

    const convert = new ConvertDateHour();

    const createPdf = new CreatePdf();

    let processedContacts = resumed;

    for (const messageAttendanceId of historyContact) {

      if (checkpoint.has(messageAttendanceId.message_id)) continue;

      const historyMessage = await historyMessageService.execute(await token.accessToken, companyId, messageAttendanceId);

      // Usar for...of ao invés de forEach para await funcionar corretamente
      for (const item of historyMessage) {

        let year = convert.dateYear(item.firstMessageAt);
        let month = convert.dateMonth(item.firstMessageAt);
        let day = convert.dateDay(item.firstMessageAt);

        if (await dir.verifyDir(`${localdir}`) === false) {
          dir.createDir(`${localdir}`);
        }
        if (await dir.verifyDir(`${localdir}${year}`) === false) {
          dir.createDir(`${localdir}${year}`);
        }

        if (await dir.verifyDir(`${localdir}${year}/${month}`) === false) {
          dir.createDir(`${localdir}${year}/${month}`);
        }

        if (await dir.verifyDir(`${localdir}${year}/${month}/${day}`) === false) {
          dir.createDir(`${localdir}${year}/${month}/${day}`);
        }

        if (await dir.verifyDir(`${localdir}${year}/${month}/${day}/${item.protocol}`) === false) {
          dir.createDir(`${localdir}${year}/${month}/${day}/${item.protocol}`);
        }

        let directory = `${localdir}${year}/${month}/${day}/${item.protocol}`;
        if (item.contactId.slice(0, 2) === "em") {
          console.log("Card", item);
        }

        // Erro ao montar o PDF é problema do conteúdo desse atendimento: registra e segue,
        // senão a mensagem volta para a fila e trava a extração em loop no mesmo contato.
        // Erros da API (token, rede) continuam subindo e a extração é retomada pelo checkpoint.
        try {
          await createPdf.execute(item, directory);
        } catch (err: any) {
          const error = err?.message || String(err);
          console.error(`\n❌ Falha ao gerar PDF do protocolo ${item.protocol}: ${error}`);
          fs.appendFileSync(
            failuresFile,
            JSON.stringify({ at: new Date().toISOString(), protocol: item.protocol, contactId: item.contactId, directory, error }) + "\n"
          );
        }
      }

      checkpoint.mark(messageAttendanceId.message_id);

      processedContacts++;
      progressTracker.updateProgress(
        jobId,
        processedContacts,
        `Processando contato ${processedContacts}/${totalContacts}`
      );
    }

    checkpoint.clear();

    if (fs.existsSync(failuresFile)) {
      console.log(`\n⚠️ Alguns atendimentos falharam ao gerar PDF. Veja ${failuresFile}`);
    }

    progressTracker.completeJob(jobId, 'Extração finalizada com sucesso!');
    console.log("Finalizado Processamento");

    return { jobId, totalContacts: processedContacts };
  }
}


export { HistoryGeneratorService }