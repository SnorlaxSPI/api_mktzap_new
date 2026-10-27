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
}

class ProgressTracker extends EventEmitter {
  private jobs: Map<string, ProgressData> = new Map();

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
    };

    this.jobs.set(jobId, progress);
    this.emit('progress', progress);
    this.logProgress(progress);

    return progress;
  }

  /**
   * Atualiza o progresso de um job
   */
  updateProgress(jobId: string, current: number, message?: string): ProgressData | null {
    const progress = this.jobs.get(jobId);
    if (!progress) return null;

    const now = new Date();
    const elapsed = now.getTime() - progress.startedAt.getTime();
    const itemsPerMs = current / elapsed;
    const remaining = progress.total - current;

    progress.current = current;
    progress.percentage = Math.round((current / progress.total) * 100);
    progress.status = 'processing';
    progress.updatedAt = now;

    if (message) {
      progress.message = message;
    }

    // Estima tempo restante (em segundos)
    if (itemsPerMs > 0) {
      progress.estimatedTimeRemaining = Math.round(remaining / itemsPerMs / 1000);
    }

    this.emit('progress', progress);
    this.logProgress(progress);

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
    progress.status = 'completed';
    progress.message = message;
    progress.updatedAt = new Date();
    progress.estimatedTimeRemaining = 0;

    this.emit('progress', progress);
    this.emit('complete', progress);
    this.logProgress(progress);

    return progress;
  }

  /**
   * Marca job com erro
   */
  errorJob(jobId: string, errorMessage: string): ProgressData | null {
    const progress = this.jobs.get(jobId);
    if (!progress) return null;

    progress.status = 'error';
    progress.message = errorMessage;
    progress.updatedAt = new Date();

    this.emit('progress', progress);
    this.emit('error', progress);
    this.logProgress(progress);

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
    return this.jobs.delete(jobId);
  }

  /**
   * Lista todos os jobs ativos
   */
  getAllJobs(): ProgressData[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Exibe o progresso no console com barra visual colorida
   */
  private logProgress(progress: ProgressData): void {
    const barLength = 40;
    const filled = Math.round((progress.percentage / 100) * barLength);
    const empty = barLength - filled;

    // --- Helpers de cor (ANSI truecolor) ---
    const rgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const dim = '\x1b[2m';

    // Degradê vermelho -> âmbar -> verde ao longo da barra
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

    // Cor sólida em estados finais
    const forcedColor =
      progress.status === 'completed' ? rgb(46, 213, 115) :
      progress.status === 'error'     ? rgb(255, 76, 96)  : null;

    // Monta a barra preenchida com degradê célula a célula
    let filledBar = '';
    for (let i = 0; i < filled; i++) {
      const color = forcedColor ?? colorAt(i / Math.max(1, barLength - 1));
      filledBar += color + '█';
    }
    const emptyBar = dim + rgb(80, 80, 90) + '░'.repeat(empty) + reset;
    const bar = filledBar + emptyBar;

    const statusIcon = {
      pending: '⏳',
      processing: '🔄',
      completed: '✅',
      error: '❌'
    }[progress.status];

    const pctColor = forcedColor ?? colorAt(progress.percentage / 100);
    const pct = `${pctColor}${bold}${progress.percentage}%${reset}`;
    const counts = `${dim}(${progress.current}/${progress.total})${reset}`;
    const jobId = `${dim}${rgb(120, 160, 220)}[${progress.jobId}]${reset}`;

    // Tempo restante e mensagem (quando disponíveis)
    const eta =
      progress.status === 'processing' && progress.estimatedTimeRemaining
        ? ` ${dim}⏱ ${this.formatTime(progress.estimatedTimeRemaining)}${reset}`
        : '';
    const msg = progress.message ? ` ${dim}· ${progress.message}${reset}` : '';

    const line = `${statusIcon} ${jobId} ${bar} ${pct} ${counts}${eta}${msg}`;

    // Limpa a linha atual e escreve na mesma posição
    process.stdout.write('\r\x1b[K' + line);

    // Pula linha apenas quando completo ou com erro (para preservar a mensagem final)
    if (progress.status === 'completed' || progress.status === 'error') {
      process.stdout.write('\n');
    }
  }

  /**
   * Formata tempo em minutos:segundos
   */
  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

// Singleton global para o tracker
const progressTracker = new ProgressTracker();

export { ProgressTracker, ProgressData, progressTracker };
