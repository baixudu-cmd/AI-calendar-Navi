// P4 自用观察模拟 CLI：默认不读取真实密钥，不写飞书。

import { formatSelfUseObservationReport, runSelfUseObservation } from "./self-use-observation.js";

const result = await runSelfUseObservation();
console.log(formatSelfUseObservationReport(result));
if (!result.ok) process.exitCode = 1;
