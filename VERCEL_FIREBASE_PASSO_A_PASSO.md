# Publicar no GitHub + Vercel usando Firebase Firestore

Este projeto esta preparado para:

- **GitHub** guardar o codigo.
- **Vercel** publicar a plataforma web.
- **Firebase Firestore** guardar todos os dados: pacientes, agendamentos, evolucoes, fichas e avaliacoes.
- **Firebase Admin SDK** rodar somente no servidor da Vercel. Assim, as credenciais sensiveis nao ficam no navegador.

## 1. Antes de subir para o GitHub

Nao envie dados locais de pacientes para o GitHub.

O arquivo `.gitignore` ja bloqueia:

- `data/*.json`
- `.env`
- `.env.local`
- `.vercel/`
- `tmp/`
- logs do servidor

## 2. Criar o projeto no Firebase

1. Acesse [Firebase Console](https://console.firebase.google.com/).
2. Clique em **Adicionar projeto**.
3. Crie o projeto e anote o **Project ID**.
4. No menu esquerdo, abra **Build > Firestore Database**.
5. Clique em **Criar banco de dados**.
6. Escolha **Production mode**.
7. Escolha a regiao do banco.

## 3. Criar a credencial do Firebase

Esta aplicacao na Vercel usa uma **conta de servico** do Firebase.

1. No Firebase Console, clique na engrenagem do projeto.
2. Abra **Configuracoes do projeto**.
3. Entre na aba **Contas de servico**.
4. Clique em **Gerar nova chave privada**.
5. Baixe o arquivo `.json`.
6. Guarde esse arquivo com cuidado. Ele e uma credencial sensivel.

## 4. Converter a credencial para Base64

No PowerShell, rode:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\CAMINHO\DO\ARQUIVO-firebase-adminsdk.json"))
```

Copie o texto grande que aparecer.

## 5. Criar o repositorio no GitHub

1. Acesse [GitHub](https://github.com/).
2. Crie um repositorio novo.
3. Envie a pasta do projeto para esse repositorio.

Pasta do projeto:

```text
outputs/gestao-fisio-web
```

## 6. Importar o projeto na Vercel

1. Acesse [Vercel](https://vercel.com/).
2. Clique em **Add New > Project**.
3. Escolha o repositorio do GitHub.
4. Em **Framework Preset**, deixe como **Other**.
5. Em **Build Command**, deixe vazio ou `npm install`.
6. Em **Output Directory**, deixe vazio.
7. Antes de publicar, configure as variaveis abaixo.

## 7. Configurar credenciais na Vercel

Na tela do projeto da Vercel:

1. Abra **Settings**.
2. Abra **Environment Variables**.
3. Adicione esta variavel:

```text
FIREBASE_SERVICE_ACCOUNT_BASE64
```

Valor:

```text
cole aqui o Base64 gerado no PowerShell
```

Marque para os ambientes:

- Production
- Preview
- Development, se for testar com `vercel dev`

Depois clique em **Save**.

4. Adicione tambem a senha inicial da plataforma:

```text
INITIAL_ADMIN_PASSWORD
```

Valor:

```text
digite a senha que voce quer usar para entrar no sistema
```

Essa senha inicial nao fica salva em arquivo local. No primeiro acesso da plataforma publicada, a API da Vercel grava uma versao protegida dessa senha no Firestore, dentro da colecao `appConfig`.

Depois que confirmar que conseguiu entrar, voce pode remover `INITIAL_ADMIN_PASSWORD` da Vercel e fazer outro deploy. A senha protegida continuara salva no Firestore.

### Opcao alternativa

Se preferir nao usar Base64, cadastre estas tres variaveis:

```text
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

No `FIREBASE_PRIVATE_KEY`, mantenha as quebras de linha como `\n` se colar em uma linha so.

## 8. Publicar

Na Vercel, clique em **Deploy**.

Quando terminar, abra a URL gerada pela Vercel.

## 9. Primeiro acesso

Ao abrir a plataforma pela primeira vez:

1. Entre com a senha configurada em `INITIAL_ADMIN_PASSWORD`.
2. A senha protegida ja fica salva no Firestore.
3. Depois disso, os dados ficam protegidos por login.

Se voce nao configurar `INITIAL_ADMIN_PASSWORD`, a plataforma ainda pode mostrar a tela de criar senha no primeiro acesso. Para web publicada, o recomendado e usar `INITIAL_ADMIN_PASSWORD`.

## 9.1. Se aparecer "Nao foi possivel salvar" ao criar a senha

Isso normalmente significa que a Vercel abriu o site, mas a API nao conseguiu gravar no Firebase.

Confira nesta ordem:

1. Na Vercel, abra o projeto.
2. Va em **Settings > Environment Variables**.
3. Confirme que existem as variaveis:

```text
FIREBASE_SERVICE_ACCOUNT_BASE64
INITIAL_ADMIN_PASSWORD
```

4. Confirme que elas estao marcadas para **Production**.
5. Clique em **Deployments**.
6. Abra o ultimo deploy.
7. Clique em **Redeploy**.

Depois do redeploy, abra:

```text
https://SEU-SITE-DA-VERCEL.vercel.app/api/health
```

O esperado e aparecer:

```json
{
  "ok": true,
  "firebaseServiceAccountBase64": "configurado",
  "initialAdminPassword": "configurado"
}
```

Se aparecer `nao configurado`, a Vercel ainda nao recebeu a credencial ou a senha inicial.

Se o `/api/health` estiver ok e mesmo assim nao salvar, confira no Firebase se o **Firestore Database** foi criado.

## 10. Importar os dados locais para o Firestore

Se voce ja tem pacientes no modo local e quer mandar para o Firebase:

1. Copie `.env.example` para `.env.local`.
2. Preencha `FIREBASE_SERVICE_ACCOUNT_BASE64`.
3. Rode:

```bash
node scripts/import-local-to-firestore.js
```

Esse comando importa:

- pacientes
- evolucoes
- agendamentos
- avaliacoes e fichas

## 11. Onde os dados ficam no Firebase

No Firestore, a aplicacao usa estas colecoes:

```text
patients
sessions
appointments
treatmentAssessments
appConfig
authSessions
```

Nada de pacientes, fichas, avaliacoes ou agendamentos fica salvo no computador na versao publicada pela Vercel. Esses dados ficam no Firestore.

## 12. Links uteis

- [Firebase Console](https://console.firebase.google.com/)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)
- [Cloud Firestore](https://firebase.google.com/docs/firestore/manage-databases)
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)
- [GitHub](https://github.com/)
