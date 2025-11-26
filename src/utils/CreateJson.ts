import fs from "fs";
import Path from "path";
import { ConvertDateHour } from "./ConvertDateHour";
import { Download } from "./Download";
import { Format } from "./Format";
import { InternalServerError } from "../middlewares/InternalServerError";

class CreateJson {

  async execute(historyMessage: any, directory: string) {
    const convert = new ConvertDateHour();
    const download = new Download();
    const format = new Format();

    /**
     * ======================================================
     * 1) NOME SEGURO DO ARQUIVO JSON
     * ======================================================
     */
    const idParts = historyMessage.contactId.split("_");
    const baseName = idParts[2] || idParts[1] || idParts[0];

    const outputFilename =
      historyMessage.contactId.startsWith("waweb")
        ? `${directory}/${baseName}.json`
        : `${directory}/${baseName}_${historyMessage.protocol}.json`;

    // garantir diretório
    fs.mkdirSync(Path.dirname(outputFilename), { recursive: true });

    /**
     * ======================================================
     * 2) DETECTAR MÍDIAS COM REGEX
     * ======================================================
     */
    const mediaRegex = /\[(media|image|attachment|audio|video)[^\]]*\]/gi;
    const mediaItems: Array<any> = [];

    for (const m of historyMessage.messages) {
      const textMessage = typeof m.message === "string" ? m.message : String(m.message || "");
      const matches = [...textMessage.matchAll(mediaRegex)];

      for (const mt of matches) {
        const mediaString = mt[0];
        const mediaData = this.parseMediaAttributes(mediaString);

        // tipo
        let typeMedia = (mediaData.type || "").toLowerCase();
        if (!typeMedia) {
          const tag = mediaString.toLowerCase();
          typeMedia =
            tag.startsWith("[image") ? "image" :
              tag.startsWith("[audio") ? "audio" :
                tag.startsWith("[video") ? "video" :
                  "document";
        }

        // url
        let url = mediaData.file;
        if (!url) {
          const urlMatch = textMessage.match(/https?:\/\/[^\s\]]+/);
          url = urlMatch ? urlMatch[0] : undefined;
        }

        // nome do arquivo
        let rawName = mediaData.name;
        if (!rawName || rawName === "undefined") {
          rawName = Path.basename(mediaData.file || "arquivo");
        }

        let ext = Path.extname(rawName);
        if (!ext || ext === ".") {
          ext = Path.extname(mediaData.file || "");
          rawName = rawName + ext;
        }

        // sanitizar nome
        rawName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_");

        mediaItems.push({
          key: `${m.id}_${rawName}`,
          messageId: m.id,
          typeMedia,
          url,
          rawName,
          createdAt: m.createdAt
        });
      }
    }

    /**
     * ======================================================
     * 3) DOWNLOAD DAS MÍDIAS
     * ======================================================
     */
    const downloadResults = await Promise.all(
      mediaItems.map(async item => {
        if (!item.url)
          return { key: item.key, savedPath: null };

        try {
          switch (item.typeMedia) {
            case "image":
              return { key: item.key, savedPath: await download.image(directory, item.url, item.rawName) };

            case "audio":
              return { key: item.key, savedPath: await download.audio(directory, item.url, item.rawName) };

            case "video":
              return { key: item.key, savedPath: await download.video(directory, item.url, item.rawName) };

            default:
              return { key: item.key, savedPath: await download.document(directory, item.url, item.rawName) };
          }
        } catch {
          return { key: item.key, savedPath: null };
        }
      })
    );

    const savedMap = new Map(downloadResults.map(r => [r.key, r.savedPath]));

    /**
     * ======================================================
     * 4) MONTAR JSON FINAL
     * ======================================================
     */
    const resultJson: any = {
      protocol: historyMessage.protocol,
      contactId: historyMessage.contactId,
      name: historyMessage.name,
      startedAt: {
        date: convert.date(historyMessage.firstMessageAt),
        time: convert.hour(historyMessage.firstMessageAt),
        full: convert.dateComplete(historyMessage.firstMessageAt)
      },
      messages: []
    };

    for (const m of historyMessage.messages) {
      const formattedMessage =
        historyMessage.contactId.startsWith("em")
          ? await format.email(m.message)
          : m.message;

      const messageRecord: any = {
        messageId: m.id,
        from: m.name,
        text: formattedMessage,
        createdAt: convert.dateComplete(m.createdAt),
        medias: []
      };

      const relatedMedias = mediaItems.filter(mi => mi.messageId === m.id);

      for (const mi of relatedMedias) {
        const savedPath = savedMap.get(mi.key);

        messageRecord.medias.push({
          type: mi.typeMedia,
          name: mi.rawName,
          urlOriginal: mi.url,
          savedPath: savedPath || null,
          createdAt: convert.dateComplete(mi.createdAt)
        });
      }

      resultJson.messages.push(messageRecord);
    }

    /**
     * ======================================================
     * 5) SALVAR O JSON
     * ======================================================
     */
    try {
      fs.writeFileSync(outputFilename, JSON.stringify(resultJson, null, 2));
    } catch {
      throw new InternalServerError("Failed to save JSON");
    }

    return resultJson;
  }

  /**
   * Extração de atributos de mídia
   */
  private parseMediaAttributes(mediaString: string): any {
    const attrRegex = /(\w+)=["']?([^"'\]\s]+)["']?/g;
    const attributes: any = {};
    let match;

    while ((match = attrRegex.exec(mediaString)) !== null) {
      attributes[match[1]] = match[2];
    }

    if (!attributes.file) {
      const urlMatch = mediaString.match(/https?:\/\/[^\s\]]+/);
      if (urlMatch) attributes.file = urlMatch[0];
    }

    return attributes;
  }
}

export { CreateJson };
