import Fs from "fs";
import Axios from "axios";
import Path from "path";
import retry from "axios-retry";
import { InternalServerError } from "../middlewares/InternalServerError";

const https = require("https");

const axiosInstance = Axios.create({
  timeout: 60000,
  method: "GET",
  responseType: "stream",
  httpsAgent: new https.Agent({ keepAlive: true }),
});

retry(axiosInstance, { retries: 3 });

class Download {

  private ensureDir(directory: string) {
    try {
      Fs.mkdirSync(directory, { recursive: true });
    } catch { }
  }

  /**
   * ✅ Normaliza o nome do arquivo
   * - remove caracteres inválidos
   * - remove duplicação de extensão (ex.: .mp3.pdf → .mp3)
   * - remove sufixos _.pdf_0, _.mp4_1, etc
   * - mantém extensão original se existir
   * - se não tiver extensão, usa a default
   */
  private normalizeFileName(idMessage: string, defaultExt: string) {
    if (!idMessage) return `file${defaultExt}`;

    // pega o nome após a última "/"
    let cleaned = Path.basename(String(idMessage).split("?")[0]);

    // remove caracteres inválidos para nome de arquivo
    cleaned = cleaned.replace(/[^a-zA-Z0-9._-]/g, "_");

    // remove sufixos como .pdf_0, .mp3_1 etc
    cleaned = cleaned.replace(/(\.[a-z0-9]{2,5})_\d+$/i, "$1");

    // remove extensão duplicada (.mp3.pdf => .mp3)
    cleaned = cleaned.replace(/(\.[a-z0-9]{2,5})\.[a-z0-9]{2,5}$/i, "$1");

    // se não tiver extensão, adiciona a default
    if (!/\.[a-z0-9]{2,5}$/i.test(cleaned)) {
      cleaned += defaultExt;
    }

    return cleaned;
  }

  private async streamToFile(url: string, filePath: string) {
    try {
      const response = await axiosInstance({ url });

      await new Promise<void>((resolve, reject) => {
        const writer = Fs.createWriteStream(filePath);
        response.data.pipe(writer);

        writer.on("finish", resolve);
        writer.on("error", reject);
      });

    } catch (err: any) {
      throw new InternalServerError(err?.message || String(err));
    }
  }

  /** 📌 IMAGEM */
  async image(directory: string, urlImage: string, idMessage: string) {
    this.ensureDir(directory);
    const fileName = this.normalizeFileName(idMessage, ".jpg");
    const path = Path.resolve(directory, fileName);
    await this.streamToFile(urlImage, path);
    return path;
  }

  /** 📌 DOCUMENTOS (pdf, doc, txt, etc) */
  async document(directory: string, urlDocument: string, idMessage: string) {
    this.ensureDir(directory);
    const fileName = this.normalizeFileName(idMessage, ".pdf");
    const path = Path.resolve(directory, fileName);
    await this.streamToFile(urlDocument, path);
    return path;
  }

  /** 📌 ÁUDIO (mp3, m4a, wav) */
  async audio(directory: string, urlAudio: string, idMessage: string) {
    this.ensureDir(directory);
    const fileName = this.normalizeFileName(idMessage, ".mp3");
    const path = Path.resolve(directory, fileName);
    await this.streamToFile(urlAudio, path);
    return path;
  }

  /** 📌 VÍDEO */
  async video(directory: string, urlVideo: string, idMessage: string) {
    this.ensureDir(directory);
    const fileName = this.normalizeFileName(idMessage, ".mp4");
    const path = Path.resolve(directory, fileName);
    await this.streamToFile(urlVideo, path);
    return path;
  }
}

export { Download };
