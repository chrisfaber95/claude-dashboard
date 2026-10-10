import type { PermissionMode } from './commands.ts';
import type { LimitsInfo } from './limits.ts';
import type { PermissionRequestInfo } from './permissions.ts';
import type { AlertsInfo } from './alerts.ts';
import type { MessageInfo, ProjectInfo, RecentSession, SessionInfo, SubagentInfo } from './sessions.ts';
import type { TeamBoard } from './team.ts';
import type { TokenCounts, UsageDay } from './usage.ts';

export interface DashboardState {
  generatedAtMs: number;
  projects: ProjectInfo[];
  sessions: SessionInfo[];
  /** Subagents of live sessions that are working or finished recently. */
  subagents: SubagentInfo[];
  messages: MessageInfo[];
  usage: { days: UsageDay[]; totals: TokenCounts; byModel: Record<string, number> };
  limits: LimitsInfo;
  recentSessions: RecentSession[];
  features: {
    lan: boolean;
    commands: boolean;
    permissionModes: readonly PermissionMode[];
    /** True only for the loopback `pc` request: only it may create, list and revoke devices. */
    manageDevices: boolean;
  };
  /** Team board summary; null = no board found (hidden). */
  team: TeamBoard | null;
  /** Things that need the user, derived on the server and de-duplicated by id. */
  alerts: AlertsInfo;
  /** Permission prompts of dashboard-started sessions that wait for an answer, plus recently expired ones. */
  permissions: PermissionRequestInfo[];
}
