import PDFDocument from "pdfkit";
import fs from "fs";
import Path from "path";
import { ConvertDateHour } from "./ConvertDateHour";
import { Download } from "./Download";
import { Format } from "./Format";
import { InternalServerError } from "../middlewares/InternalServerError";

class CreatePdf {
  async execute(historyMessage: any, directory: string) {
    const convert = new ConvertDateHour();
    const download = new Download();
    const format = new Format();

    /**
     * +-----------------------------------------------------+
     * | 1) CRIA O PDF                                       |
     * +-----------------------------------------------------+
     */
    const outputFilename =
      historyMessage.contactId.split("_")[0] !== "waweb"
        ? `${directory}/${historyMessage.contactId.split("_")[2]}_${historyMessage.protocol}.pdf`
        : `${directory}/${historyMessage.contactId.split("_")[2]}.pdf`;

    const doc = new PDFDocument({ autoFirstPage: true, margin: 30 });
    const pdfStream = fs.createWriteStream(outputFilename);
    doc.pipe(pdfStream);

    /**
     * +-----------------------------------------------------+
     * | 2) CABEÇALHO                                        |
     * +-----------------------------------------------------+
     */
    doc.fontSize(14);
    doc.text(`Nome: ${historyMessage.name}`);
    doc.text(`Telefone: ${historyMessage.contactId.split("_")[2]}`);
    doc.text(`Protocolo: ${historyMessage.protocol}`);
    doc.text(
      `Iniciou o contato em ${convert.date(historyMessage.firstMessageAt)} às ${convert.hour(historyMessage.firstMessageAt)}`
    );
    doc.moveDown().moveDown();

    /**
     * +-----------------------------------------------------+
     * | 3) LOCALIZA MÍDIAS                                  |
     * +-----------------------------------------------------+
     */
    const mediaTagRegex = /\[(media|image|attachment|audio|video)[^\]]*\]/gi;
    const mediaItems: Array<any> = [];

    historyMessage.messages.forEach((m: any) => {
      const textMessage = typeof m.message === "string" ? m.message : String(m.message || "");
      const matches = [...textMessage.matchAll(mediaTagRegex)];

      matches.forEach((mt: any) => {
        const mediaString = mt[0];
        const mediaData = this.parseMediaAttributes(mediaString);

        let typeMedia = (mediaData.type || "").toLowerCase();
        if (!typeMedia) {
          const tag = mediaString.toLowerCase();
          typeMedia =
            tag.startsWith("[image") ? "image" :
              tag.startsWith("[audio") ? "audio" :
                tag.startsWith("[video") ? "video" : "document";
        }

        let url = mediaData.file;
        if (!url) {
          const urlMatch = textMessage.match(/https?:\/\/[^\s\]]+/);
          url = urlMatch ? urlMatch[0] : undefined;
        }

        let rawName = mediaData.name;
        if (!rawName || rawName === "undefined") {
          rawName = Path.basename(mediaData.file || "arquivo");
        }

        let ext = Path.extname(rawName);
        if (!ext || ext === ".") {
          ext = Path.extname(mediaData.file || "");
          rawName = rawName + ext;
        }

        rawName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_");
        rawName = rawName.replace(/(\.[a-z0-9]{2,5})_\d+$/i, "$1");

        mediaItems.push({
          key: `${m.id}_${rawName}`,
          messageId: m.id,
          typeMedia,
          url,
          rawName,
          createdAt: m.createdAt
        });
      });
    });

    /**
     * +-----------------------------------------------------+
     * | 4) DOWNLOAD DAS MÍDIAS                              |
     * +-----------------------------------------------------+
     */
    const downloadResults = await Promise.all(
      mediaItems.map(async (item) => {
        if (!item.url) return { key: item.key, savedPath: undefined };

        try {
          switch (item.typeMedia) {
            case "image": return { key: item.key, savedPath: await download.image(directory, item.url, item.rawName) };
            case "audio": return { key: item.key, savedPath: await download.audio(directory, item.url, item.rawName) };
            case "video": return { key: item.key, savedPath: await download.video(directory, item.url, item.rawName) };
            default: return { key: item.key, savedPath: await download.document(directory, item.url, item.rawName) };
          }
        } catch {
          return { key: item.key, savedPath: undefined };
        }
      })
    );

    const savedMap = new Map<string, string | undefined>(downloadResults.map((r: any) => [r.key, r.savedPath]));

    /**
     * +-----------------------------------------------------+
     * | 5) ESCREVE MENSAGENS + LINKS PARA MÍDIAS           |
     * +-----------------------------------------------------+
     */
    for (const m of historyMessage.messages) {
      doc.moveDown();
      doc.font("Helvetica-Bold").text(`${m.name}`);

      const formattedMessage =
        historyMessage.contactId.slice(0, 2) === "em"
          ? await format.email(m.message)
          : m.message;

      doc.font("Helvetica").text(`${convert.dateComplete(m.createdAt)}: ${formattedMessage}`);

      const related = mediaItems.filter(mi => mi.messageId === m.id);

      for (const mi of related) {
        const savedPath = savedMap.get(mi.key);

        if (!savedPath || !fs.existsSync(savedPath)) continue;

        // ⬇️ NOVO COMPORTAMENTO: MESMO DA EXTRAÇÃO ANTIGA
        doc.moveDown();
        doc.fillColor("blue")
          .text(`${convert.dateComplete(m.createdAt)}: Clique aqui para visualizar "${mi.rawName}"`,
            { link: savedPath, underline: true }
          )
          .fillColor("black");

        // SOMENTE EXIBIR IMAGEM, NÃO MOSTRAR MP3/MP4/DOC
        if (mi.typeMedia === "image") {
          doc.moveDown();
          try {
            doc.image(savedPath, { fit: [300, 300], align: "center" });
          } catch { /* apenas ignorar caso a imagem esteja corrompida */ }
        }
      }
    }

    /**
     * +-----------------------------------------------------+
     * | 6) FINALIZA O PDF                                   |
     * +-----------------------------------------------------+
     */
    doc.end();
  }

  private parseMediaAttributes(mediaString: string): any {
    const attrRegex = /(\w+)=["']?([^"'\]\s]+)["']?/g;
    const attributes: any = {};
    let match;

    while ((match = attrRegex.exec(mediaString)) !== null) {
      attributes[match[1]] = match[2];
    }

    if (!attributes.file) {
      const urlMatch = String(mediaString).match(/https?:\/\/[^\s\]]+/);
      if (urlMatch) attributes.file = urlMatch[0];
    }

    return attributes;
  }
}

export { CreatePdf };
