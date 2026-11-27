export async function onRequest(context) {
  const url = new URL(context.request.url);
  const match = url.pathname.match(/^\/branch-(code-[a-z0-9-]+)(\/.*)?$/i);
  if (!match) return context.next();

  const branchAlias = match[1].toLowerCase();
  const target = new URL(url.toString());
  target.protocol = "https:";
  target.hostname = branchAlias + ".zhineng.pages.dev";
  target.port = "";
  target.pathname = match[2] || "/";
  return Response.redirect(target.toString(), 302);
}
