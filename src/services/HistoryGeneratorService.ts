import { ConvertDateHour } from "../utils/ConvertDateHour";
import { CreateJson } from "../utils/CreateJson";
import { Directory } from "../utils/Directory";
import { AccessTokenService } from "./AccessTokenService";
import { HistoryContactService } from "./HistoryContactService";
import { HistoryMessageService } from "./HistoryMessageService";
import { InternalServerError } from "../middlewares/InternalServerError";
import * as dotenv from "dotenv";

dotenv.config();

const localdir = process.env?.DIR || "./temp/";

/*
 * Generates history JSON (previously PDF)
 *
 * @Param companyId, clientKey, dateFrom, dateTo
 *
 * @return object
 */
class HistoryGeneratorService {
  async execute(companyId: string, clientKey: string, dateFrom: string, dateTo: string) {
    if (!companyId) {
      throw new InternalServerError("companyId incorrect!");
    }

    if (!clientKey) {
      throw new InternalServerError("clientKey incorrect!");
    }

    if (!dateFrom) {
      throw new InternalServerError("dateFrom incorrect!");
    }

    if (!dateTo) {
      throw new InternalServerError("dateTo incorrect!");
    }

    const accessTokenService = new AccessTokenService();
    const token = await accessTokenService.execute(companyId, clientKey);

    if (!token) {
      throw new InternalServerError("Failed generate token");
    }

    const historyContactService = new HistoryContactService();
    const historyContact = await historyContactService.execute(
      token.accessToken,
      companyId,
      dateFrom,
      dateTo
    );

    const historyMessageService = new HistoryMessageService();
    const dir = new Directory();
    const convert = new ConvertDateHour();
    const createJson = new CreateJson(); // 👈 Substituído

    for (const messageAttendanceId of historyContact) {
      const historyMessage = await historyMessageService.execute(
        token.accessToken,
        companyId,
        messageAttendanceId
      );

      for (const item of historyMessage) {
        const year = convert.dateYear(item.firstMessageAt);
        const month = convert.dateMonth(item.firstMessageAt);
        const day = convert.dateDay(item.firstMessageAt);

        // Garantir estrutura de pastas
        await dir.ensureDir(localdir);
        await dir.ensureDir(`${localdir}${year}`);
        await dir.ensureDir(`${localdir}${year}/${month}`);
        await dir.ensureDir(`${localdir}${year}/${month}/${day}`);
        await dir.ensureDir(`${localdir}${year}/${month}/${day}/${item.protocol}`);

        const directory = `${localdir}${year}/${month}/${day}/${item.protocol}`;

        // 👉 Agora salva JSON no lugar do PDF
        await createJson.execute(item, directory);
      }
    }

    console.log("Finalizado Processamento (JSON gerado)");
  }
}

export { HistoryGeneratorService };
