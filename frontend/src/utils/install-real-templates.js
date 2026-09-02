import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const indexHtmlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../index.html");

export function installRealTemplates() {
	/* Installs templates for test functions, for mountTemplate() to use. */

	// Reads the real index.html rather than duplicating template markup in test code, so
	// tests stay accurate if the templates change.
	const html = readFileSync(indexHtmlPath, "utf-8");
	// Only the <body> is extracted before reparsing.
	const bodyStart = html.indexOf("<body");
	const bodyEnd = html.indexOf("</body>") + "</body>".length;
	const bodyOnly = html.slice(bodyStart, bodyEnd);

	const doc = new DOMParser().parseFromString(`<html>${bodyOnly}</html>`, "text/html");
	doc.querySelectorAll("template").forEach((tpl) => {
		// cloneNode so templates are copied into the *actual* test document.body.
		document.body.appendChild(tpl.cloneNode(true));
	});
}
