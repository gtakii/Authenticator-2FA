# Authenticator-2FA

Extensão de navegador desenvolvida em JavaScript para gerenciamento de autenticação em dois fatores (2FA), com geração de códigos temporários TOTP, armazenamento criptografado e gerenciamento de autenticadores.

O projeto tem como objetivo oferecer uma maneira prática de organizar e acessar códigos de autenticação diretamente pelo navegador, aplicando conceitos de desenvolvimento de software e segurança da informação.

## Funcionalidades implementadas

### Autenticação em dois fatores
- Geração de códigos temporários utilizando TOTP (RFC 6238).
- Suporte aos algoritmos SHA-1, SHA-256 e SHA-512.
- Atualização automática dos códigos de autenticação.
- Cadastro de contas por QR Code.
- Importação por URI no formato `otpauth://`.
- Cadastro manual de autenticadores.

### Segurança e armazenamento
- Criptografia de dados utilizando AES-256-GCM.
- Derivação de chaves utilizando PBKDF2.
- Armazenamento local de dados criptografados.
- Bloqueio automático do cofre.
- Backup e restauração de dados criptografados.

### Gerenciamento de contas
- Cadastro e gerenciamento de autenticadores.
- Organização de contas por categorias.
- Possibilidade de favoritar contas.
- Visualização dos códigos temporários.
- Interface para gerenciamento das contas cadastradas.

## Funcionalidades em desenvolvimento

O projeto ainda está em desenvolvimento. Algumas funcionalidades já possuem elementos disponíveis na interface, mas ainda não estão completamente implementadas.

Entre os recursos que estão em construção estão:

- **Leitura e importação de arquivos:** implementação do processamento de arquivos para identificação e importação de informações de autenticadores.
- **Processamento de dados:** melhorias na leitura, interpretação e tratamento de informações importadas.
- **Recursos adicionais de importação:** ampliação das possibilidades de adicionar e transferir autenticadores.
- **Aprimoramentos da interface:** ajustes de comportamento, usabilidade e integração entre os recursos.

**Atenção:** alguns botões e opções podem aparecer na interface mesmo quando a funcionalidade correspondente ainda não está concluída. Nesses casos, o recurso pode não executar a ação esperada.

O desenvolvimento continua em andamento, e essas funcionalidades serão implementadas e aprimoradas gradualmente.

## Tecnologias utilizadas

- **JavaScript:** lógica e funcionamento da extensão.
- **HTML5:** estrutura das interfaces.
- **CSS3:** estilização e organização visual.
- **Web Crypto API:** operações criptográficas.
- **TOTP (RFC 6238):** geração de códigos temporários.
- **AES-256-GCM:** criptografia dos dados.
- **PBKDF2:** derivação de chaves criptográficas.
- **Node.js Test Runner:** execução dos testes automatizados.

## Como baixar e instalar

A instalação é feita diretamente pelo navegador, sem necessidade de executar comandos no terminal.

### 1. Baixar o projeto

1. Acesse o repositório do projeto no GitHub.
2. Clique no botão **Code**.
3. Selecione **Download ZIP**.
4. Aguarde o download.
5. Extraia o arquivo ZIP para uma pasta do computador.

### 2. Instalar no Google Chrome

1. Abra o Google Chrome.
2. Digite o seguinte endereço na barra de navegação:

   `chrome://extensions/`

3. Pressione Enter.
4. Ative a opção **Modo do desenvolvedor**, localizada no canto superior direito.
5. Clique em **Carregar sem compactação**.
6. Localize a pasta extraída do projeto.
7. Selecione a pasta que contém o arquivo `manifest.json`.

Após esse procedimento, a extensão será carregada no navegador.

### 3. Abrir e utilizar

1. Clique no ícone de extensões do Chrome.
2. Localize o projeto.
3. Clique para abrir a extensão.
4. Siga as instruções da interface para configurar o acesso inicial.
5. Cadastre um autenticador utilizando QR Code, URI ou inserção manual.
6. Explore as funcionalidades disponíveis.

## O que testar na aplicação

Após a instalação, é possível testar os recursos disponíveis diretamente pela interface da extensão:

- Configuração inicial e acesso ao cofre.
- Cadastro de autenticadores.
- Importação de contas por QR Code.
- Cadastro manual de contas.
- Geração e atualização dos códigos TOTP.
- Organização de autenticadores por categorias.
- Favoritamento de contas.
- Bloqueio e desbloqueio do cofre.
- Criação de backups criptografados.
- Restauração de backups.

Alguns recursos podem apresentar limitações por ainda estarem em desenvolvimento.

## Testes automatizados

Além dos testes realizados diretamente no navegador, o projeto possui uma suíte de testes automatizados utilizando o test runner nativo do Node.js.

**Último resultado registrado:**

| Resultado | Quantidade |
|---|---:|
| Testes executados | 28 |
| Aprovados | 28 |
| Falhas | 0 |

Os testes abrangem componentes como criptografia, geração TOTP, interpretação de URIs, processamento relacionado a QR Codes e configurações da extensão.

Para executar os testes manualmente, é necessário ter o Node.js instalado.

Na pasta principal do projeto, execute:

```bash
node --test tests/*.test.mjs
```

Os testes automatizados complementam a validação prática da aplicação, mas não substituem os testes de interface realizados diretamente no navegador.

## Estrutura do projeto

```text
Authenticator-2FA/
│
├── .gitignore
├── manifest.json
├── README.md
│
├── popup/
│   └── Arquivos da interface
│
├── scripts/
│   └── Scripts e funcionalidades
│
├── tests/
│   └── Testes automatizados
│
├── assets/
│   └── Recursos visuais
│
└── icons/
    └── Ícones da extensão
```

## Objetivo do projeto

O projeto foi desenvolvido como projeto de estudo e aplicação prática de conhecimentos em desenvolvimento de software e segurança da informação.

Durante o desenvolvimento, são trabalhados conceitos como:

- Autenticação em dois fatores.
- Criptografia e proteção de dados.
- Armazenamento local seguro.
- Desenvolvimento de extensões para navegadores.
- Manipulação e processamento de dados.
- Testes automatizados.
- Organização e manutenção de código.

## Aviso de segurança

Este projeto possui finalidade educacional e de estudo.

Apesar da implementação de mecanismos criptográficos e da realização de testes automatizados, o software não passou por uma auditoria independente de segurança.

Portanto, não deve ser considerado uma solução certificada ou garantida para proteger contas e informações críticas.

Recomenda-se utilizar contas de teste durante a avaliação do projeto.

## Status do projeto

**Em desenvolvimento.**

O projeto continua recebendo melhorias, correções e novas implementações. Algumas funcionalidades já estão disponíveis para utilização, enquanto outras permanecem em construção.
