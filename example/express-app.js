'use strict';

const express = require('express');
const trace = require('../index');

trace.init({
  slowThreshold: 200,
  samplingRate: 1,
  maxTraces: 500,
  retentionSeconds: 120,
});

trace.useLogger('console');

const app = express();

app.use(trace.middleware());
app.use(trace.routes());

app.get('/checkout', async (req, res) => {
  await trace.step('authMiddleware', async () => {
    await sleep(12);
  });

  await trace.step('validateInput', async () => {
    await sleep(5);
  });

  await trace.step('dbQuery', async () => {
    await sleep(210);
  });

  await trace.step('paymentService', async () => {
    await sleep(45);
  });

  await trace.step('responseRender', async () => {
    await sleep(30);
  });

  res.json({ message: 'done' });
});

app.get('/fast', async (req, res) => {
  await trace.step('cache', async () => {
    await sleep(5);
  });
  res.json({ message: 'fast' });
});

app.get('/error', async (req, res) => {
  await trace.step('validate', async () => {
    throw new Error('Validation failed');
  }).catch(() => {});
  res.status(400).json({ error: 'bad request' });
});

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Example server running at http://localhost:${PORT}`);
  console.log(`📊 Dashboard at http://localhost:${PORT}/trace/ui`);
  console.log(`\nTry:`);
  console.log(`  curl http://localhost:${PORT}/checkout`);
  console.log(`  curl http://localhost:${PORT}/fast`);
  console.log(`  curl http://localhost:${PORT}/error\n`);
});
