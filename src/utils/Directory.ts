import fs from 'fs';
import path from 'path';

class Directory {
  async ensureDir(folder: string) {
    try {
      fs.mkdirSync(folder, { recursive: true });
      return true;
    } catch (err) {
      console.error("Erro ao criar diretório:", err);
      return false;
    }
  }

  async verifyDir(folder: string) {
    return fs.existsSync(folder);
  }
}

export { Directory };
