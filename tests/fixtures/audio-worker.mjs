const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = Buffer.concat(chunks);
switch (process.argv[2]) {
  case 'echo': process.stdout.write(input); break;
  case 'env': process.stdout.write(JSON.stringify({ leaked: Boolean(process.env.PAPERCLIP_TEST_SECRET_SHOULD_NOT_CROSS), offline: process.env.HF_HUB_OFFLINE })); break;
  case 'large': process.stdout.write(Buffer.alloc(2048)); break;
  case 'hang': setInterval(() => {}, 1000); break;
  default: process.exitCode = 1;
}
