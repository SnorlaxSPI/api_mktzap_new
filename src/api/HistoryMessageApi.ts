import axios from "axios";
import retry from "axios-retry";
import { InternalServerError } from "../middlewares/InternalServerError";

// Com vários contatos em paralelo a API pode responder 429 (limite de requisições):
// tenta de novo com espera crescente, assim como em erros de rede e 5xx
const api = axios.create();

retry(api, {
  retries: 4,
  retryDelay: retry.exponentialDelay,
  retryCondition: (error) =>
    retry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 429,
});

class HistoryMessageApi {
  // Operadores da empresa [user_id => name], buscados uma vez por instância e não a cada contato
  private usersByCompany = new Map<string, Promise<Map<any, any>>>();

  private users(token: string, companyId: string) {
    let users = this.usersByCompany.get(companyId);

    if (!users) {
      users = api
        .get(`https://api.mktzap.com.br/company/${companyId}/user`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
        .then((usersResponse) => new Map(usersResponse.data.map((user: any) => [user.id, user.name])));

      this.usersByCompany.set(companyId, users);
      // Se falhar, a próxima chamada busca de novo
      users.catch(() => this.usersByCompany.delete(companyId));
    }

    return users;
  }

  /*
   * Called HistoryMessage API MKTZap
   *
   * @Param token, companyId, message
   *
   * @return object
   */
  async execute(token: string, companyId: string, message: any) {
    try {
      const cards: any[] = [];

      // 1. Operadores da empresa [user_id => name]
      const usersMap = await this.users(token, companyId);

      // 2. Busca o histórico de mensagens daquele atendimento
      const historyResponse = await api.get(
        `https://api.mktzap.com.br/company/${companyId}/history/${message.message_id}/message`,
        {
          headers: {
            "Content-type": "application/json",
            "charset": "UTF-8",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      // 3. Monta os dados da conversa com nome do operador (ou "Auto")
      const cardData = {
        messageId: message.message_id,
        protocol: message.protocol,
        firstMessageAt: message.firstMessageAt,
        name: message.name,
        contactId: message.contact_id,
        messages: [] as any[],
      };

      for (const item of historyResponse.data) {
        const isHtml = item.message?.search(/<[^>]*>/g) >= 0;
        const parsedMessage = isHtml ? item.message : JSON.parse(item.message);

        cardData.messages.push({
          id: item.id,
          createdAt: item.created_at,
          message: parsedMessage,
          user_id: item.user_id,
          sent_by_operator: item.sent_by_operator,
          name:
            item.sent_by_operator === 1
              ? usersMap.get(item.user_id) ?? "Operador"
              : "Auto",
        });
      }

      cards.push(cardData);
      return cards;
    } catch (err: any) {
      console.error("Erro em HistoryMessageApi:", err);
      throw new InternalServerError("Erro ao requisitar histórico de mensagens: " + err.message);
    }
  }
}

export { HistoryMessageApi };
