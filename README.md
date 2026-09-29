# Ana Paula Fisioterapeuta

Aplicacao web local para cadastro de pacientes, evolucoes e agenda da clinica.

## Como iniciar na rede local

1. Abra a pasta `gestao-fisio-web`.
2. Clique com o botao direito em `iniciar-na-rede-local.ps1` e escolha **Executar com PowerShell**.
3. O terminal vai mostrar um ou mais enderecos `http://...:3080`.
4. No primeiro acesso, a tela vai pedir para criar uma senha.
5. Em outros computadores ou celulares na mesma rede Wi-Fi, abra o endereco mostrado como **Na rede local** e entre com a mesma senha.

Os dados ficam salvos no arquivo `data/pacientes.json` dentro desta pasta.
A senha fica protegida no arquivo `data/auth.json`; a senha original nao e gravada em texto aberto.

## Como publicar na web

O projeto tambem esta preparado para publicar com:

- GitHub para guardar o codigo.
- Vercel para hospedar a plataforma.
- Firebase Firestore para salvar todos os dados da aplicacao.

Siga o guia:

```text
VERCEL_FIREBASE_PASSO_A_PASSO.md
```

Na versao publicada, o navegador nao acessa o Firestore direto. A plataforma chama a API da Vercel, e a API usa credenciais seguras configuradas nas variaveis de ambiente.

## Observacoes importantes

- Este sistema foi feito para rede interna. Evite expor a internet.
- Para encerrar, volte ao terminal e pressione `Ctrl+C`.
- Se o Windows pedir permissao de rede, permita o acesso na rede privada da clinica.
- Para trocar a senha, entre no sistema e use o botao **Trocar senha**.
