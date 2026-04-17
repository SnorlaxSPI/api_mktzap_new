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
    progressTracker.updateProgress(jobId, 10, `${totalContacts} contatos encontrados. Iniciando processamento...`);

    // Atualiza o total para refletir a quantidade real de trabalho
    const progress = progressTracker.getProgress(jobId);
    if (progress) {
      progress.total = totalContacts;
      progress.current = 0;
    }

    const historyMessageService = new HistoryMessageService()

    const dir = new Directory();

    const convert = new ConvertDateHour();

    const createPdf = new CreatePdf();

    let processedContacts = 0;

    for (const messageAttendanceId of historyContact) {

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
          await createPdf.execute(item, directory);
        } else {
          await createPdf.execute(item, directory);
        }
      }

      processedContacts++;
      progressTracker.updateProgress(
        jobId,
        processedContacts,
        `Processando contato ${processedContacts}/${totalContacts}`
      );
    }

    progressTracker.completeJob(jobId, 'Extração finalizada com sucesso!');
    console.log("Finalizado Processamento");

    return { jobId, totalContacts: processedContacts };
  }
}


export { HistoryGeneratorService }