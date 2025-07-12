import axios from "axios";
import { InternalServerError } from "../middlewares/InternalServerError";

class HistoryMessageApi {
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

      // 1. Busca os operadores da empresa e cria um map [user_id => name]
      const usersResponse = await axios.get(
        `https://api.mktzap.com.br/company/${companyId}/user`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const usersMap = new Map(
        usersResponse.data.map((user: any) => [user.id, user.name])
      );

      // 2. Busca o histórico de mensagens daquele atendimento
      const historyResponse = await axios.get(
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
