// Referencia a un usuario ("quién hizo qué"): id, username y nombre.
export interface UserRefView {
  userId: string;
  username?: string | null;
  person?: { firstName?: string | null; lastName?: string | null } | null;
}

export function toUserRef(user: UserRefView | null | undefined) {
  if (!user) {
    return null;
  }
  return {
    userId: user.userId,
    username: user.username,
    fullName: [user.person?.firstName, user.person?.lastName].filter(Boolean).join(' ') || null
  };
}
