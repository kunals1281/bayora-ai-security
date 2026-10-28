import type {
  ModelAdapter,
  ModelGenerateRequest,
  ModelGenerateResponse,
} from "../../adapters/models";

export interface TargetEndpointPoolMember {
  id: string;
  name: string;
  adapter: ModelAdapter;
  weight?: number;
  activeRequests: number;
  totalRequests: number;
  totalErrors: number;
  isHealthy: boolean;
}

export type BalancingStrategy = "round-robin" | "least-connections" | "primary-fallback";

export class RequestBalancer {
  private members: TargetEndpointPoolMember[] = [];
  private currentIndex = 0;
  private strategy: BalancingStrategy;

  constructor(strategy: BalancingStrategy = "round-robin") {
    this.strategy = strategy;
  }

  addMember(member: Omit<TargetEndpointPoolMember, "activeRequests" | "totalRequests" | "totalErrors" | "isHealthy">) {
    this.members.push({
      ...member,
      activeRequests: 0,
      totalRequests: 0,
      totalErrors: 0,
      isHealthy: true,
    });
  }

  getMembers(): TargetEndpointPoolMember[] {
    return [...this.members];
  }

  selectMember(): TargetEndpointPoolMember {
    const healthyMembers = this.members.filter((m) => m.isHealthy);
    const pool = healthyMembers.length > 0 ? healthyMembers : this.members;

    if (pool.length === 0) {
      throw new Error("No target LLM endpoints registered in balancer pool");
    }

    if (this.strategy === "round-robin") {
      const member = pool[this.currentIndex % pool.length];
      this.currentIndex = (this.currentIndex + 1) % pool.length;
      return member;
    }

    if (this.strategy === "least-connections") {
      return [...pool].sort((a, b) => a.activeRequests - b.activeRequests)[0];
    }

    // primary-fallback: try first healthy member
    return pool[0];
  }

  async executeWithBalancing(
    request: ModelGenerateRequest,
  ): Promise<ModelGenerateResponse> {
    const member = this.selectMember();
    member.activeRequests++;
    member.totalRequests++;

    try {
      const result = await member.adapter.generate(request);
      return result;
    } catch (err) {
      member.totalErrors++;
      // If error occurred and other members exist, attempt failover
      const fallbackCandidates = this.members.filter(
        (m) => m.id !== member.id && m.isHealthy,
      );

      if (fallbackCandidates.length > 0) {
        const fallback = fallbackCandidates[0];
        fallback.totalRequests++;
        fallback.activeRequests++;
        try {
          const res = await fallback.adapter.generate(request);
          return res;
        } finally {
          fallback.activeRequests = Math.max(0, fallback.activeRequests - 1);
        }
      }

      throw err;
    } finally {
      member.activeRequests = Math.max(0, member.activeRequests - 1);
    }
  }

  getPoolStats() {
    return this.members.map((m) => ({
      id: m.id,
      name: m.name,
      activeRequests: m.activeRequests,
      totalRequests: m.totalRequests,
      totalErrors: m.totalErrors,
      isHealthy: m.isHealthy,
    }));
  }
}
