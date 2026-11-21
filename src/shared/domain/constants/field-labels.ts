const FIELD_LABELS: Record<string, string> = {
  username: 'nombre de usuario',
  email: 'correo electrónico',
  national_id: 'número de documento',
  person_id: 'persona'
  // email_hash, auth_username → NO se mapean a propósito
};
const DEFAULT_FIELD_LABEL = 'uno de los datos ingresados';
export default { FIELD_LABELS, DEFAULT_FIELD_LABEL };
