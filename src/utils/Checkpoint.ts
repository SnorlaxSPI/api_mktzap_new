import fs from "fs";
import Path from "path";

/*
* Guarda os contatos já processados de uma extração para permitir retomar
* de onde parou caso o worker seja interrompido (Ctrl+C, crash, restart).
*
* Um arquivo por extração: <dir>/.checkpoints/<companyId>_<dateFrom>_<dateTo>.json
* Um id por linha, só acrescentado (não regrava o arquivo inteiro a cada contato).
*/
class Checkpoint {
  private file: string;
  private done: Set<string>;

  constructor(dir: string, companyId: string, dateFrom: string, dateTo: string) {
    const checkpointDir = Path.join(dir, ".checkpoints");
    fs.mkdirSync(checkpointDir, { recursive: true });

    this.file = Path.join(checkpointDir, `${companyId}_${dateFrom}_${dateTo}.json`);
    this.done = new Set(this.load());
  }

  private load(): string[] {
    let content: string;
    try {
      content = fs.readFileSync(this.file, "utf8");
    } catch {
      return [];
    }

    // Formato antigo (array JSON): converte para um id por linha para poder só acrescentar
    if (content.trimStart().startsWith("[")) {
      let ids: string[] = [];
      try {
        ids = JSON.parse(content).map(String);
      } catch { }
      fs.writeFileSync(this.file, ids.map((id) => id + "\n").join(""));
      return ids;
    }

    return content.split("\n").filter(Boolean);
  }

  has(id: string | number): boolean {
    return this.done.has(String(id));
  }

  get size(): number {
    return this.done.size;
  }

  mark(id: string | number) {
    const key = String(id);
    if (this.done.has(key)) return;
    this.done.add(key);
    fs.appendFileSync(this.file, key + "\n");
  }

  clear() {
    fs.rmSync(this.file, { force: true });
  }
}

export { Checkpoint }
