import express, { Router, Request, Response, NextFunction, Handler, response } from "express";
import { AccessTokenController } from "../controllers/AccessTokenController";
import { HistoryGeneratorController } from "../controllers/HistoryGeneratorController";
import { sendToQueue } from "../rabbitmq-server";
import { progressTracker } from "../utils/ProgressTracker";

const resolver = (handlerFn: Handler) => {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      return await Promise.resolve(handlerFn(request, response, next));
    } catch (e) {
      return next(e);
    }
  }
}

const router = Router();

const accessTokenController = new AccessTokenController;

const historyGeneratorController = new HistoryGeneratorController



router.post('/token', resolver(accessTokenController.handle))

router.post('/history', (request: Request, response: Response) => {

  sendToQueue("companyData", request.body);
  return response.json();
})

/**
 * 📊 SSE Endpoint - Acompanhar progresso em tempo real
 * 
 * Uso: GET /progress/:jobId
 * Ou para todos os jobs: GET /progress
 */
router.get('/progress/:jobId?', (request: Request, response: Response) => {
  const { jobId } = request.params;

  // Configura headers para SSE
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.flushHeaders();

  // Função para enviar dados ao cliente
  const sendProgress = (data: any) => {
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Se jobId específico, envia status atual
  if (jobId) {
    const currentProgress = progressTracker.getProgress(jobId);
    if (currentProgress) {
      sendProgress(currentProgress);
    } else {
      sendProgress({ error: 'Job não encontrado', jobId });
    }
  } else {
    // Lista todos os jobs ativos
    sendProgress({ jobs: progressTracker.getAllJobs() });
  }

  // Listener para atualizações de progresso
  const onProgress = (progress: any) => {
    if (!jobId || progress.jobId === jobId) {
      sendProgress(progress);
    }
  };

  const onComplete = (progress: any) => {
    if (!jobId || progress.jobId === jobId) {
      sendProgress(progress);
      // Fecha conexão após completar
      if (progress.jobId === jobId) {
        response.end();
      }
    }
  };

  progressTracker.on('progress', onProgress);
  progressTracker.on('complete', onComplete);
  progressTracker.on('error', onComplete);

  // Limpa listeners quando conexão é fechada
  request.on('close', () => {
    progressTracker.off('progress', onProgress);
    progressTracker.off('complete', onComplete);
    progressTracker.off('error', onComplete);
  });
});

/**
 * 📋 GET - Lista todos os jobs e seus status
 */
router.get('/jobs', (request: Request, response: Response) => {
  const jobs = progressTracker.getAllJobs();
  return response.json({
    total: jobs.length,
    jobs: jobs.map(job => ({
      jobId: job.jobId,
      status: job.status,
      percentage: job.percentage,
      current: job.current,
      total: job.total,
      message: job.message,
      estimatedTimeRemaining: job.estimatedTimeRemaining,
      startedAt: job.startedAt
    }))
  });
});


export { router }