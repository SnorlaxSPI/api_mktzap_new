import fs from "fs";
import Path from "path";

/*
* Guarda os contatos já processados de uma extração para permitir retomar
* de onde parou caso o worker seja interrompido (Ctrl+C, crash, restart).
*
* Um arquivo por extração: <dir>/.checkpoints/<companyId>_<dateFrom>_<dateTo>.json
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
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return [];
    }
  }

  has(id: string | number): boolean {
    return this.done.has(String(id));
  }

  get size(): number {
    return this.done.size;
  }

  mark(id: string | number) {
    this.done.add(String(id));
    fs.writeFileSync(this.file, JSON.stringify([...this.done]));
  }

  clear() {
    fs.rmSync(this.file, { force: true });
  }
}

export { Checkpoint }
