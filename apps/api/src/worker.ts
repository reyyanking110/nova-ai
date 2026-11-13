import { db, result, log } from './core.js';
import {
  processOutbound,
  processReminder,
  processWebhook,
  notifyWebhookFailure,
} from './processing.js';
import { setTimeout } from 'node:timers/promises';
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
log.info('NOVA worker started; run a single worker instance to preserve message order');
while (!stopping) {
  try {
    result(await db().rpc('enqueue_reminders'));
    const jobs = result(await db().rpc('claim_jobs', { batch_size: 1 }));
    for (const job of jobs ?? []) {
      try {
        if (job.kind === 'webhook') await processWebhook(job.payload);
        else if (job.kind === 'reminder') await processReminder(job.payload);
        else await processOutbound(job.payload, job.unique_key);
        result(
          await db()
            .from('scheduled_jobs')
            .update({ status: 'completed', locked_at: null, last_error: null })
            .eq('id', job.id),
        );
      } catch (error) {
        const failed = job.attempts >= 5;
        result(
          await db()
            .from('scheduled_jobs')
            .update({
              status: failed ? 'failed' : 'pending',
              locked_at: null,
              run_at: new Date(
                Date.now() + Math.min(300000, 2 ** job.attempts * 5000),
              ).toISOString(),
              last_error: error instanceof Error ? error.message.slice(0, 250) : 'Job failed',
            })
            .eq('id', job.id),
        );
        if (failed && job.kind === 'reminder')
          await db()
            .from('reminders')
            .update({ status: 'failed' })
            .eq('id', job.payload.reminder_id)
            .eq('status', 'scheduled');
        if (failed && job.kind === 'webhook' && job.user_id) {
          try {
            await notifyWebhookFailure(job.payload, job.user_id);
          } catch {
            log.warn('Could not queue failure notice');
          }
        }
        log.warn(
          { jobId: job.id, kind: job.kind, attempt: job.attempts },
          'Job failed; see protected job dashboard',
        );
      }
    }
  } catch {
    log.warn('Worker database unavailable; retrying');
  }
  await setTimeout(2000);
}
log.info('Worker stopped gracefully');
