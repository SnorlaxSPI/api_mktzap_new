import pdf from "pdfkit";
import puppetter from "puppeteer";
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
      // Verifica se a mensagem contém metadados de mídia (tanto [media...] quanto [image...])
      const mediaMatch = m.message.match(/\[(media|image)[^\]]*\]/);

      if (mediaMatch) {
        // Extrai os atributos do metadado de mídia
        const mediaData = this.parseMediaAttributes(mediaMatch[0]);

        // Determina o tipo de mídia
        let typeMedia = mediaData.type;
        if (!typeMedia && mediaMatch[0].startsWith('[image')) {
          typeMedia = 'image';
        }

        if (mediaData && mediaData.file) {
          const url = mediaData.file;
          const fileExtension = this.getFileExtension(typeMedia, url);

          try {
            // Baixa o arquivo conforme o tipo
            switch (typeMedia) {
              case 'image':
                await download.image(directory, url, m.id);
                break;
              case 'document':
              case 'attachment':
                await download.document(directory, url, m.id);
                break;
              case 'audio':
                await download.audio(directory, url, m.id);
                break;
              case 'video':
                await download.video(directory, url, m.id);
                break;
              default:
                console.warn(`Tipo de mídia não suportado: ${typeMedia}`);
                continue;
            }

            // Adiciona o link no PDF
            doc.moveDown();
            doc.text(`${convert.dateComplete(m.createdAt)}:`);
            doc.fillColor("blue")
              .text(`Clique aqui para visualizar "${m.id}${fileExtension}"`, {
                link: `${m.id}${fileExtension}`
              });

          } catch (error) {
            console.error(`Erro ao processar mídia: ${error}`);
            doc.moveDown();
            doc.text(`${convert.dateComplete(m.createdAt)}: [Erro ao processar anexo]`);
          }
        }
      } else {
        // Trata mensagens de texto normais
        if (historyMessage.contactId.slice(0, 2) === "em") {
          doc.moveDown();
          doc.fillColor("black")
            .text(`${convert.dateComplete(m.createdAt)}: ${await format.email(m.message)}`);
        } else {
          doc.moveDown();
          doc.fillColor("black")
            .text(`${convert.dateComplete(m.createdAt)}: ${m.message}`);
        }
      }
    }

    // Define o nome do arquivo PDF de saída
    const outputFilename = historyMessage.contactId.split('_')[0] !== "waweb"
      ? `${directory}/${historyMessage.contactId.split('_')[2]}_${historyMessage.protocol}.pdf`
      : `${directory}/${historyMessage.contactId.split('_')[2]}.pdf`;

    doc.pipe(fs.createWriteStream(outputFilename));
    doc.end();
  }

  // Método auxiliar para extrair atributos dos metadados de mídia
  private parseMediaAttributes(mediaString: string): any {
    const attrRegex = /(\w+)="([^"]*)"/g;
    const attributes: any = {};
    let match;

    while ((match = attrRegex.exec(mediaString)) !== null) {
      attributes[match[1]] = match[2];
    }

    return attributes;
  }

  // Método auxiliar para determinar a extensão do arquivo
  private getFileExtension(typeMedia: string, url: string): string {
    if (url.match(/\.\w+($|\?)/)) {
      const extensionMatch = url.match(/\.(\w+)($|\?)/);
      if (extensionMatch) return `.${extensionMatch[1]}`;
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

  // ... (mantido o método byHtml existente)
}

export { CreatePdf };