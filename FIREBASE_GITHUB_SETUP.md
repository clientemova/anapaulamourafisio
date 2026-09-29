# Publicacao com Firebase + GitHub

Esta pasta ja esta preparada para uma publicacao futura usando:

- Firebase Hosting para a interface.
- Cloud Functions for Firebase para as rotas `/api`.
- Firestore para pacientes, agendamentos, evolucoes e avaliacoes.
- GitHub Actions para publicar automaticamente quando houver push na branch `main`.

## 1. Criar o projeto no Firebase

1. Acesse o Firebase Console.
2. Crie um projeto.
3. Ative Firestore.
4. Ative Cloud Functions.
5. Ative Firebase Hosting.
6. Guarde o **Project ID**.

## 2. Configurar o projeto local

Copie `.firebaserc.example` para `.firebaserc` e troque:

```json
{
  "projects": {
    "default": "SEU_PROJECT_ID_FIREBASE"
  }
}
```

por:

```json
{
  "projects": {
    "default": "o-id-real-do-seu-projeto"
  }
}
```

## 3. Testar localmente com emuladores

Instale o Firebase CLI e rode:

```bash
npm run firebase:emulators
```

## 4. Publicar manualmente

Depois de fazer login no Firebase CLI:

```bash
npm run firebase:deploy
```

## 5. Conectar GitHub Actions

No GitHub, crie os secrets do repositorio:

- `FIREBASE_PROJECT_ID`: o Project ID do Firebase.
- `FIREBASE_SERVICE_ACCOUNT`: o JSON completo de uma conta de servico com permissao para deploy.

Depois disso, todo push na branch `main` executa `.github/workflows/firebase-deploy.yml`.

## 6. Primeiro acesso

Depois do deploy, abra a URL do Firebase Hosting e crie a senha de acesso imediatamente.
Enquanto a senha ainda nao existir, a primeira pessoa com acesso ao link poderia criar a senha.

## 7. Importar dados locais

A versao local salva em `data/pacientes.json`.
A versao web salva no Firestore. Antes de publicar de verdade para uso continuo, importe os dados locais com:

```bash
node scripts/import-local-to-firestore.js
```

Esse script precisa de credenciais do Firebase no ambiente.

## Observacao de seguranca

Firestore esta bloqueado para acesso direto pelo navegador em `firestore.rules`. O app usa apenas a Cloud Function com cookie de sessao.
Para uma etapa mais robusta, o proximo passo recomendado e trocar o login por Firebase Authentication.
