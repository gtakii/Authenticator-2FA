# Changelog

Histórico de alterações do Authenticator 2FA.

## [1.0.0] - Primeira versão

### Funcionalidades
- Geração de códigos de autenticação de dois fatores (TOTP).
- Suporte aos algoritmos HMAC-SHA1, HMAC-SHA256 e HMAC-SHA512.
- Cofre local protegido com criptografia AES-256-GCM.
- Importação de contas por URI otpauth.
- Suporte à leitura de QR Codes.
- Backup criptografado e restauração de dados.

### Segurança
- Armazenamento local de dados.
- Validação de parâmetros TOTP.
- Proteção contra adulteração de backups.
- Permissões mínimas no Manifest V3.

### Interface
- Redesign da interface do Authenticator 2FA.
- Organização das telas e funcionalidades da extensão.

### Testes
- Testes automatizados com Node.js.
- Integração contínua utilizando GitHub Actions.
