export function mountTemplate(container, templateId) {
	/* Clones the named <template> from index.html into the given container. */

	const template = document.getElementById(templateId);
	if (!template) {
		throw new Error(`#${templateId} not found in index.html`);
	}
	container.innerHTML = "";
	container.appendChild(template.content.cloneNode(true));
}
