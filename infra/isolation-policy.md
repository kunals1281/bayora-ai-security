# Bayora Container & Network Isolation Architecture

## Multi-Tenant Micro-Segmentation

1. **Networks**:
   - `red_net` (internal: true): Strictly hosts Red Team attacker runners. No direct egress to internet or other tenants.
   - `blue_net` (internal: true): Strictly hosts Blue Team defense classifiers.
   - `target_net` (internal: true): Hosts target inference model (e.g. Ollama / vLLM). Ingress restricted strictly to the Gateway.
   - `public_net` (bridge): Exposes the Gateway edge (port 4000) and Web console (port 3000).

2. **Linux Container Hardening**:
   - `user: "1000:1000"` (non-root execution).
   - `cap_drop: [ALL]` (dropped all Linux capabilities: no `CAP_NET_RAW`, no `CAP_SYS_ADMIN`, no `CAP_DAC_OVERRIDE`).
   - `read_only: true` (read-only root filesystem prevents binary drops and persistence).
   - `security_opt: ["no-new-privileges:true"]` (blocks SUID privilege escalation).
   - `pids_limit: 100` (prevents fork-bombs and thread exhaustion).
   - `mem_limit: 512m` and `cpus: 1.0` (bounds noisy neighbor resource starvation).
   - `tmpfs: /tmp:rw,noexec,nosuid,size=64m` (ephemeral no-exec scratch space only).
