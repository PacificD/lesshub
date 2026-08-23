# Rendering benchmark (quick)

Run: 2026-08-22T204934-329Z-ea865659

Results are local-machine observations and are not comparable across machines. CSR shell, catalog BFF, and combined transactions are controls and are never ranked with complete SSR responses. Cold results contain latency samples only; no sustained cold RPS is reported.

## Server segments

| Scenario | Strategy | Cache | Count | p50 ms | p95 ms | p99 ms | RPS | Comparable |
|---|---|---:|---:|---:|---:|---:|---:|---|
| warm | html-cache | warm | 37715 | 2.38 | 4.33 | 5.75 | 3772.00 | yes |
| cold | html-cache | cold | 10 | 4.85 | 6.53 | 6.53 | N/A | yes |
| cold-burst | html-cache | cold | 10 | 7.33 | 7.38 | 7.38 | N/A | yes |
| cold-burst | html-cache | cold | 10 | 5.14 | 5.18 | 5.18 | N/A | yes |
| cold-burst | html-cache | cold | 10 | 5.66 | 5.69 | 5.69 | N/A | yes |
| warm | data-cache | warm | 7324 | 12.42 | 22.60 | 32.28 | 732.40 | yes |
| cold | data-cache | cold | 10 | 3.95 | 10.14 | 10.14 | N/A | yes |
| cold-burst | data-cache | cold | 10 | 16.11 | 16.14 | 16.14 | N/A | yes |
| cold-burst | data-cache | cold | 10 | 13.96 | 13.98 | 13.98 | N/A | yes |
| cold-burst | data-cache | cold | 10 | 12.87 | 12.90 | 12.90 | N/A | yes |
| warm | live-ssr | N/A | 7732 | 11.77 | 22.88 | 31.44 | 773.20 | yes |
| cold | live-ssr | N/A | 10 | 1.87 | 2.33 | 2.33 | N/A | yes |
| cold-burst | live-ssr | N/A | 10 | 6.34 | 12.44 | 12.44 | N/A | yes |
| cold-burst | live-ssr | N/A | 10 | 9.47 | 12.87 | 12.87 | N/A | yes |
| cold-burst | live-ssr | N/A | 10 | 9.98 | 13.03 | 13.03 | N/A | yes |
| warm | csr-shell | N/A | 87463 | 0.90 | 2.31 | 2.91 | 8748.00 | no |
| warm | csr-catalog-bff | N/A | 55933 | 1.56 | 2.68 | 3.12 | 5594.00 | no |
| cold | csr-shell | N/A | 10 | 0.52 | 1.20 | 1.20 | N/A | no |
| cold-burst | csr-shell | N/A | 10 | 1.91 | 2.97 | 2.97 | N/A | no |
| cold-burst | csr-shell | N/A | 10 | 2.62 | 2.66 | 2.66 | N/A | no |
| cold-burst | csr-shell | N/A | 10 | 2.91 | 2.93 | 2.93 | N/A | no |
| combined | csr-combined | N/A | 10 | 0.96 | 1.41 | 1.41 | N/A | no |

## CSR combined transaction cost

| Round | Transactions | Requests/transaction | Total requests | Transaction p95 ms | Response bytes p50/p95/p99 |
|---:|---:|---:|---:|---:|---:|
| 0 | 10 | 2 | 20 | 1.41 | 9735/9735/9735 |

## Warm throughput aggregates

N/A for the single-round quick profile.

## Correctness

- PASS: html-cache-cold-burst-coalescing-r0 — {"concurrency":10,"apiCalls":1,"ssrCalls":1,"leaders":1,"waiters":9}
- PASS: data-cache-cold-burst-coalescing-r0 — {"concurrency":10,"apiCalls":1,"ssrCalls":10,"leaders":1,"waiters":9}
- PASS: mutation-price — {"observedAffectedMisses":6,"observedUnaffectedHits":18,"priceMinor":999,"formattedPrice":"£9.99","dataVersion":2}
- PASS: mutation-translation — {"observedAffectedMisses":8,"observedUnaffectedHits":16,"name":"Benchmark Translation","dataVersion":3}
- PASS: mutation-inventory — {"observedTargetKeys":24,"inventory":0,"dataVersion":4}
- PASS: mutation-product — {"observedTargetKeys":24}
- PASS: mutation-reset — {"observedTargetKeys":24,"inventory":18,"dataVersion":1}
- PASS: redis-failure — {"html":"BYPASS","data":"BYPASS","live":"control","csr":"control"}
- PASS: commerce-failure — {"cached":"HIT","uncached":503,"csrShell":200,"csrBff":503,"browserRetry":"recovered"}

## Browser

12 conditions; each has 10 measured samples and zero hydration errors. Browser cache evidence is recorded per condition in browser-summary.json and raw/browser/samples.ndjson.
