// Puerto: contraseñas temporales (alta de una cuenta, reset por un administrador).
export interface PasswordGenerator {
  /** 12 caracteres con al menos una mayúscula, una minúscula, un número y un símbolo. */
  generate(): string;
}
