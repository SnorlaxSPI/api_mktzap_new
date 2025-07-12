import pdf from "pdfkit";
import fs from "fs";
import { ConvertDateHour } from "./ConvertDateHour";
import { Download } from "./Download";
import { Format } from "./Format";
import { InternalServerError } from "../middlewares/InternalServerError";

class CreatePdf {
  async execute(historyMessage: any, directory: string) {
    const convert = new ConvertDateHour();
    const download = new Download();
    const format = new Format();

    const doc = new pdf();
    doc.fontSize(14);
    doc.moveDown();
    doc.text(`Nome: ${historyMessage.name}`);
    doc.text(`Telefone: ${historyMessage.contactId.split('_')[2]}`);
    doc.text(`Protocolo: ${historyMessage.protocol}`);
    doc.text(`Iniciou o contato em ${convert.date(historyMessage.firstMessageAt)} às ${convert.hour(historyMessage.firstMessageAt)}`);
    doc.moveDown();
    doc.moveDown();

    for (const m of historyMessage.messages) {
      const mediaMatch = m.message.match(/\[(media|image|attachment)[^\]]*\]/);

      if (mediaMatch) {
        const mediaData = this.parseMediaAttributes(mediaMatch[0]);

        let typeMedia = mediaData.type?.toLowerCase();
        if (!typeMedia && mediaMatch[0].startsWith('[image')) {
          typeMedia = 'image';
        }

        const url = mediaData.file;
        const fileExtension = this.getFileExtension(typeMedia, url);
        const fileName = mediaData.name || `${m.id}${fileExtension}`;

        try {
          switch (typeMedia) {
            case 'image':
              await download.image(directory, url, fileName);
              break;
            case 'document':
            case 'attachment':
              await download.document(directory, url, fileName);
              break;
            case 'audio':
              await download.audio(directory, url, fileName);
              break;
            case 'video':
              await download.video(directory, url, fileName);
              break;
            default:
              console.warn(`Tipo de mídia não suportado: ${typeMedia}`);
              continue;
          }

          doc.moveDown();
          doc.fillColor("black")
            .font("Helvetica-Bold")
            .text(`${m.name}`, { continued: false });

          doc.fillColor("blue")
            .font("Helvetica")
            .text(`${convert.dateComplete(m.createdAt)}: Clique aqui para visualizar "${fileName}"`, {
              link: fileName
            });

        } catch (error) {
          console.error(`Erro ao processar mídia: ${error}`);
          doc.moveDown();
          doc.fillColor("black")
            .font("Helvetica-Bold")
            .text(`${m.name}`, { continued: false });
          doc.text(`${convert.dateComplete(m.createdAt)}: [Erro ao processar anexo]`);
        }

      } else {
        // Mensagem comum de texto
        doc.moveDown();

        doc.fillColor("black")
          .font("Helvetica-Bold")
          .text(`${m.name}`, { continued: false });

        const formattedMessage = historyMessage.contactId.slice(0, 2) === "em"
          ? await format.email(m.message)
          : m.message;

        doc.fillColor("black")
          .font("Helvetica")
          .text(`${convert.dateComplete(m.createdAt)}: ${formattedMessage}`);
      }
    }

    const outputFilename = historyMessage.contactId.split('_')[0] !== "waweb"
      ? `${directory}/${historyMessage.contactId.split('_')[2]}_${historyMessage.protocol}.pdf`
      : `${directory}/${historyMessage.contactId.split('_')[2]}.pdf`;

    doc.pipe(fs.createWriteStream(outputFilename));
    doc.end();
  }

  private parseMediaAttributes(mediaString: string): any {
    const attrRegex = /(\w+)="([^"]*)"/g;
    const attributes: any = {};
    let match;

    while ((match = attrRegex.exec(mediaString)) !== null) {
      attributes[match[1]] = match[2];
    }

    const typeMatch = mediaString.match(/^\[(\w+)/);
    if (typeMatch) {
      attributes.type = typeMatch[1];
    }

    return attributes;
  }

  private getFileExtension(typeMedia: string, url: string): string {
    const knownExtensions = ['jpg', 'jpeg', 'png', 'gif', 'mp3', 'mp4', 'pdf', 'doc', 'docx', 'xlsx', 'csv', 'txt', 'zip', 'rar', 'ogg'];

    const extensionMatch = url.match(/\.(\w+)(\?.*)?$/);
    if (extensionMatch) {
      const ext = extensionMatch[1].toLowerCase();
      if (knownExtensions.includes(ext)) {
        return `.${ext}`;
      }
    }

    switch (typeMedia) {
      case 'image': return '.jpg';
      case 'audio': return '.mp3';
      case 'video': return '.mp4';
      case 'document':
      case 'attachment': return '.pdf';
      default: return '';
    }
  }
}

export { CreatePdf };
