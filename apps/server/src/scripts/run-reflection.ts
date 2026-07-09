import { runReflection } from '../memory/reflection.js';

runReflection()
  .then((r) => {
    console.log('reflexão concluída:', r);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
