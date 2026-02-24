export function userCanAccessADDi(user) {
  if (!user) return false;

  return [
    'admin',
    'project_manager',
    'addi_user'
  ].includes(user.role);
}
