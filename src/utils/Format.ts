import { htmlToText } from 'html-to-text';

class Format {

  async file(message: string) {
    let data = message.replace(/\[/g,"").replace(/\]/g,"").replace(/\=/g, ":").replace(/ /g, ",").replace("image", "type:image").replace(/\"/g, "").split(",");
    return data
  }

  async email(message: string){
    try {
      let messageAltered= htmlToText(message, {
        wordwrap: 130
      })

      // let messageArray = message
      //   //.replace(/\\r/g, "")
      //   .replace(/\\n/g, "</br>")
      //   //.replace(/\\t/g, "")
      //   .replace(/\"/g, "'");

      return messageAltered;
    } catch (err) {
      // HTML aninhado demais estoura a pilha do html-to-text (RangeError: Maximum call stack size exceeded).
      // Nesse caso, remove as tags de forma simples, sem recursão.
      console.error("\n⚠️ html-to-text falhou, usando conversão simples:", (err as Error).message);
      return this.stripHtml(message);
    }
  }

  private stripHtml(html: string) {
    return String(html || "")
      .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(p|div|tr|li|h[1-6]|table|blockquote)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&amp;/gi, "&")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .trim();
  }

}
  
export {Format}