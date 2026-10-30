import { HistoryContactApi } from '../api/HistoryContactApi';
import { InternalServerError} from "../middlewares/InternalServerError"

class HistoryContactService {
 
  /* 
  * Called HistoryContactAPI
  *
  * @Param token, companyId, dateFrom, dateTo, onPage (avisa a cada página lida)
  *
  * @return object
  */
  async execute(token: string, companyId: string, dateFrom: string, dateTo: string, onPage?: (page: number, found: number) => void) {
  
    if(!token) {
      throw new InternalServerError("Token uninformed")
    }

    if(!companyId) {
      throw new InternalServerError("CompanyId uninformed")
    }
    

    if(!dateFrom) {
      throw new InternalServerError("Initial Date uninformed")
    }

    if(!dateTo) {
      throw new InternalServerError("Initial Date uninformed")
    }
    
    const getHistoryContact = new HistoryContactApi();

    const historyContact = getHistoryContact.execute(token, companyId, dateFrom, dateTo, onPage);

    return historyContact;
  }
}

export {HistoryContactService};