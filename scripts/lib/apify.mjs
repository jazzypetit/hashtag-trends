// Apify actor를 실행하고 결과 데이터셋을 가져온다.
const BASE = "https://api.apify.com/v2";

async function api(path, token, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify ${res.status} ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function runActor(actorId, input, token, { timeoutMin = 20 } = {}) {
  const started = await api(`/acts/${actorId}/runs?waitForFinish=60`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
  let run = started.data;
  const deadline = Date.now() + timeoutMin * 60_000;

  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
    if (Date.now() > deadline) throw new Error(`Apify run ${run.id} timed out`);
    run = (await api(`/actor-runs/${run.id}?waitForFinish=60`, token)).data;
  }
  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify run ${run.id} ended with ${run.status}`);
  }
  return api(`/datasets/${run.defaultDatasetId}/items?clean=true&format=json`, token);
}
