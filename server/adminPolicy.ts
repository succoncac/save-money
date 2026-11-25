export interface PolicyActor {
  id: string;
  isRootAdmin: boolean;
}

export interface PolicyTarget {
  id: string;
  role: string;
  isRootAdmin: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  status: number;
  error?: string;
}

export function checkAdminSelfAction(params: {
  actorId: string;
  targetId: string;
  action: 'delete' | 'lock' | 'demote';
}): PolicyDecision {
  if (params.actorId !== params.targetId) {
    return { allowed: true, status: 200 };
  }
  if (params.action === 'delete') {
    return { allowed: false, status: 400, error: 'Không thể tự xóa tài khoản đang đăng nhập.' };
  }
  if (params.action === 'lock') {
    return { allowed: false, status: 400, error: 'Không thể tự khóa tài khoản của chính mình.' };
  }
  return { allowed: false, status: 400, error: 'Không thể tự hạ quyền quản trị của chính mình.' };
}

export function requiresOldPasswordForAdminReset(actorId: string, targetId: string): boolean {
  return actorId === targetId;
}

export function canInspectUserCredentials(
  actor: PolicyActor,
  target: PolicyTarget,
): PolicyDecision {
  if (target.isRootAdmin && !actor.isRootAdmin) {
    return {
      allowed: false,
      status: 403,
      error: 'Admin phụ không thể xem thông tin bảo mật của Quản trị gốc.',
    };
  }
  if (!actor.isRootAdmin && target.role === 'admin' && target.id !== actor.id) {
    return {
      allowed: false,
      status: 403,
      error: 'Admin phụ không thể xem thông tin bảo mật của quản trị viên khác.',
    };
  }
  return { allowed: true, status: 200 };
}
