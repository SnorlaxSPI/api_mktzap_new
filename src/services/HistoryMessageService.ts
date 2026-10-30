import { HistoryMessageApi } from "../api/HistoryMessageApi";
import { InternalServerError} from "../middlewares/InternalServerError"

class HistoryMessageService {
  // Mesma instância durante toda a extração: a lista de operadores é buscada uma vez só
  private getHistoryMessages = new HistoryMessageApi();

  /* 
  *  Called HistoryMessageAPI
  *
  * @Param token, companyId, contactId
  *
  * @return object
  */

  async execute(token: string, companyId: string, contactId: any[]) {
    
    if(!token) {
      throw new InternalServerError("Token uninformed")
    }

    
    if(!companyId) {
      throw new InternalServerError("CompanyId uninformed")
    }

    
    if(!contactId) {
      throw new InternalServerError("MessageAttendanceID uninformed");
    }

    const historyMessages = await this.getHistoryMessages.execute(token, companyId, contactId);

    return historyMessages;
  }
  
}

export { HistoryMessageService }