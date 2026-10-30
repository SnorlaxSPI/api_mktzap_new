import { EventEmitter } from 'events';

interface ProgressData {
  jobId: string;
  total: number;
  current: number;
  percentage: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  message: string;
  startedAt: Date;
  updatedAt: Date;
  estimatedTimeRemaining?: number;
  resumed: number;         // cards já extraídos numa execução anterior (checkpoint)
  active: number;          // cards sendo processados neste momento
  failed: number;          // cards cujo PDF falhou
  cardsPerSecond?: number;
}

// Terminal interativo: atualiza uma única linha. Log em arquivo/pipe: uma linha por percentual.
const isTTY = Boolean(process.stdout.isTTY);

// --- Helpers de cor (ANSI truecolor), desligados fora do terminal ---
const rgb = (r: number, g: number, b: number) => isTTY ? `\x1b[38;2;${r};${g};${b}m` : '';
const reset = isTTY ? '\x1b[0m' : '';
const bold = isTTY ? '\x1b[1m' : '';
const dim = isTTY ? '\x1b[2m' : '';

// Degradê vermelho -> âmbar -> verde conforme o percentual
const colorAt = (t: number): string => {
  const stops: Array<[number, number, number]> = [
    [255, 76, 96],   // 0%   vermelho/rosa
    [255, 189, 70],  // 50%  âmbar
    [46, 213, 115],  // 100% verde
  ];
  const clamped = Math.max(0, Math.min(1, t));
  const seg = clamped * (stops.length - 1);
  const i = Math.min(Math.floor(seg), stops.length - 2);
  const f = seg - i;
  const [r1, g1, b1] = stops[i];
  const [r2, g2, b2] = stops[i + 1];
  return rgb(
    Math.round(r1 + (r2 - r1) * f),
    Math.round(g1 + (g2 - g1) * f),
    Math.round(b1 + (b2 - b1) * f),
  );
};

const num = (n: number) => n.toLocaleString('pt-BR');

class ProgressTracker extends EventEmitter {
  private jobs: Map<string, ProgressData> = new Map();
  private processingSince: Map<string, number> = new Map();
  private lastPrinted: Map<string, { key: string; at: number }> = new Map();
  private toRender: Map<string, ProgressData> = new Map();
  private renderTimer: NodeJS.Timeout | null = null;
  private lastRenderAt = 0;
  private currentLine = '';

  /**
   * Inicia um novo job de progresso
   */
  startJob(jobId: string, total: number, message: string = 'Iniciando...'): ProgressData {
    const progress: ProgressData = {
      jobId,
      total,
      current: 0,
      percentage: 0,
      status: 'pending',
      message,
      startedAt: new Date(),
      updatedAt: new Date(),
      resumed: 0,
      active: 0,
      failed: 0,
    };

    this.jobs.set(jobId, progress);
    this.notify(progress);

    return progress;
  }

  /**
   * Atualiza a mensagem de um job que ainda está se preparando (token, busca de contatos)
   */
  updateMessage(jobId: string, message: string): ProgressData | null {
    const progress = this.jobs.get(jobId);
    if (!progress) return null;

    progress.message = message;
    progress.updatedAt = new Date();
    this.notify(progress);

    return progress;
  }

  /**
   * Define o total de cards e quantos já estavam prontos; a partir daqui o job conta como em processamento
   */
  setTotal(jobId: string, total: number, resumed: number = 0): ProgressData | null {
    const progress = this.jobs.get(jobId);
    if (!progress) return null;

    progress.total = total;
    progress.current = resumed;
    progress.resumed = resumed;
    progress.status = 'processing';
    progress.message = resumed > 0
      ? `Retomando: ${num(resumed)} cards já extraídos antes`
      : 'Extraindo cards';
    this.processingSince.set(jobId, Date.now());
    this.refresh(progress);

    return progress;
  }

  /**
   * Um card começou a ser processado
   */
  cardStarted(jobId: string): ProgressData | null {
    const progress = this.jobs.get(jobId);
    if (!progress) return null;

    progress.active++;
    this.refresh(progress);

    return progress;
  }

  /**
   * Um card terminou (ok = false quando o PDF falhou e foi registrado no log de falhas)
   */
  cardFinished(jobId: string, ok: boolean = true): ProgressData | null {
    const progress = this.jobs.get(jobId);
    if (!progress) return null;

    progress.active = Math.max(0, progress.active - 1);
    progress.current++;
    if (!ok) progress.failed++;
    this.refresh(progress);

    return progress;
  }

  /**
   * Marca job como completo
   */
  completeJob(jobId: string, message: string = 'Processamento finalizado!'): ProgressData | null {
    const progress = this.jobs.get(jobId);
    if (!progress) return null;

    progress.current = progress.total;
    progress.percentage = 100;
    progress.active = 0;
    progress.status = 'completed';
    progress.message = message;
    progress.updatedAt = new Date();
    progress.estimatedTimeRemaining = 0;

    this.notify(progress);
    this.emit('complete', progress);

    return progress;
  }

  /**
   * Marca job com erro
   */
  errorJob(jobId: string, errorMessage: string): ProgressData | null {
    const progress = this.jobs.get(jobId);
    if (!progress) return null;

    progress.active = 0;
    progress.status = 'error';
    progress.message = errorMessage;
    progress.updatedAt = new Date();

    this.notify(progress);
    // 'error' sem ninguém escutando faz o EventEmitter lançar "Unhandled error" e esconder o erro real
    if (this.listenerCount('error') > 0) {
      this.emit('error', progress);
    }

    return progress;
  }

  /**
   * Obtém o progresso de um job
   */
  getProgress(jobId: string): ProgressData | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Remove um job do tracker
   */
  removeJob(jobId: string): boolean {
    this.processingSince.delete(jobId);
    this.lastPrinted.delete(jobId);
    this.toRender.delete(jobId);
    return this.jobs.delete(jobId);
  }

  /**
   * Lista todos os jobs ativos
   */
  getAllJobs(): ProgressData[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Escreve uma mensagem avulsa sem embaralhar com a linha de progresso
   */
  log(message: string): void {
    if (isTTY && this.currentLine) {
      process.stdout.write('\r\x1b[K' + message + '\n');
      this.writeLine(this.currentLine);
    } else {
      console.log(message);
    }
  }

  /**
   * Recalcula percentual, velocidade e tempo restante e exibe
   */
  private refresh(progress: ProgressData): void {
    progress.percentage = progress.total > 0
      ? Math.floor((progress.current / progress.total) * 100)
      : 100;
    progress.updatedAt = new Date();

    // Velocidade só com o que foi feito nesta execução (os retomados não contam)
    const since = this.processingSince.get(progress.jobId);
    const doneNow = progress.current - progress.resumed;
    if (since !== undefined && doneNow > 0) {
      const elapsedSeconds = (Date.now() - since) / 1000;
      progress.cardsPerSecond = doneNow / Math.max(elapsedSeconds, 0.001);
      progress.estimatedTimeRemaining = Math.round((progress.total - progress.current) / progress.cardsPerSecond);
    }

    this.notify(progress);
  }

  private notify(progress: ProgressData): void {
    this.emit('progress', progress);

    // Estado final aparece na hora; o resto é agrupado (no máximo 10x por segundo no terminal),
    // assim um card terminando e o próximo começando viram uma atualização só
    if (progress.status === 'completed' || progress.status === 'error') {
      this.toRender.delete(progress.jobId);
      this.logProgress(progress);
      return;
    }

    this.toRender.set(progress.jobId, progress);
    if (this.renderTimer) return;

    const wait = isTTY ? Math.max(0, 100 - (Date.now() - this.lastRenderAt)) : 0;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.lastRenderAt = Date.now();
      const jobs = [...this.toRender.values()];
      this.toRender.clear();
      jobs.forEach((job) => this.logProgress(job));
    }, wait);
    this.renderTimer.unref();
  }

  /**
   * Exibe o progresso no console: percentual, cards feitos/total, em andamento, velocidade e tempo restante
   */
  private logProgress(progress: ProgressData): void {
    const line = this.formatLine(progress);
    const finished = progress.status === 'completed' || progress.status === 'error';

    if (isTTY) {
      this.writeLine(line);
      // Pula linha apenas quando completo ou com erro (para preservar a mensagem final)
      if (finished) {
        process.stdout.write('\n');
        this.currentLine = '';
      }
      return;
    }

    // Fora do terminal só imprime quando algo relevante muda (ou a cada 30s), para não inundar o log
    const key = `${progress.status}|${progress.percentage}|${progress.status === 'pending' ? progress.message : ''}`;
    const last = this.lastPrinted.get(progress.jobId);
    if (last && last.key === key && Date.now() - last.at < 30000) return;
    this.lastPrinted.set(progress.jobId, { key, at: Date.now() });
    console.log(line);
  }

  private formatLine(progress: ProgressData): string {
    const statusIcon = {
      pending: '⏳',
      processing: '🔄',
      completed: '✅',
      error: '❌'
    }[progress.status];

    const jobId = `${dim}${rgb(120, 160, 220)}[${progress.jobId}]${reset}`;
    const sep = ` ${dim}·${reset} `;

    // Ainda preparando (token, busca de contatos): só a mensagem
    if (progress.status === 'pending' || (progress.status === 'error' && progress.total === 0)) {
      return `${statusIcon} ${jobId} ${progress.message}`;
    }

    const color =
      progress.status === 'completed' ? rgb(46, 213, 115) :
      progress.status === 'error'     ? rgb(255, 76, 96)  :
      colorAt(progress.percentage / 100);

    const pct = `${color}${bold}${String(progress.percentage).padStart(3)}%${reset}`;
    const cards = `${bold}${num(progress.current)}${reset}/${num(progress.total)} cards`;
    const parts = [`${statusIcon} ${jobId} ${pct}  ${cards}`];

    if (progress.status === 'processing') {
      if (progress.resumed > 0) {
        parts.push(`${dim}${num(progress.resumed)} já extraídos antes${reset}`);
      }
      if (progress.active > 0) {
        parts.push(`${num(progress.active)} em andamento`);
      }
      if (progress.cardsPerSecond) {
        parts.push(`${dim}${this.formatRate(progress.cardsPerSecond)}${reset}`);
      }
      if (progress.estimatedTimeRemaining !== undefined && progress.current < progress.total) {
        parts.push(`⏱ ${this.formatTime(progress.estimatedTimeRemaining)} restante`);
      }
    } else {
      const since = this.processingSince.get(progress.jobId) ?? progress.startedAt.getTime();
      parts.push(`${dim}${this.formatTime(Math.round((Date.now() - since) / 1000))}${reset}`);
      parts.push(progress.message);
    }

    if (progress.failed > 0) {
      parts.push(`${rgb(255, 189, 70)}⚠ ${num(progress.failed)} ${progress.failed === 1 ? 'falha' : 'falhas'}${reset}`);
    }

    return parts.join(sep);
  }

  /**
   * Reescreve a linha atual do terminal sem quebrar linha (linhas longas são cortadas, não quebradas)
   */
  private writeLine(line: string): void {
    this.currentLine = line;
    process.stdout.write('\r\x1b[K\x1b[?7l' + line + '\x1b[?7h');
  }

  private formatRate(cardsPerSecond: number): string {
    return cardsPerSecond >= 1
      ? `${cardsPerSecond.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} cards/s`
      : `${Math.round(cardsPerSecond * 60).toLocaleString('pt-BR')} cards/min`;
  }

  /**
   * Formata tempo em minutos:segundos (ou horas:minutos:segundos)
   */
  private formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const mmss = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return hours > 0 ? `${hours}:${mmss}` : mmss;
  }
}

// Singleton global para o tracker
const progressTracker = new ProgressTracker();

export { ProgressTracker, ProgressData, progressTracker };
