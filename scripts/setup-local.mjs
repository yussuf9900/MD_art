import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
const password = `MDart-${randomBytes(12).toString("base64url")}`;
const content = `MDART_LOCAL_DATA=1\nADMIN_USERNAME=admin\nADMIN_INITIAL_PASSWORD=${password}\nSESSION_SECRET=${randomBytes(48).toString("hex")}\nANALYTICS_CUSTOM_EVENTS=0\n`;
try {
  await writeFile(".env.local", content, { flag: "wx", mode: 0o600 });
  console.log("Configuration locale créée dans .env.local (ignorée par Git).");
  console.log("Identifiant : admin");
  console.log(`Mot de passe initial : ${password}`);
  console.log(
    "Lancez npm run dev:local puis ouvrez /admin. Le premier accès impose un nouveau mot de passe.",
  );
} catch (error) {
  if (error.code === "EEXIST") {
    console.error(
      ".env.local existe déjà. Aucun fichier modifié. Consultez sa configuration locale.",
    );
    process.exitCode = 1;
  } else throw error;
}
