// Shared SWR fetcher: turns a non-ok response into a thrown Error (so SWR's error state
// fires) instead of resolving with an HTML error page's body, then parses JSON on success.
// genericErrorMessage is caller-supplied so each page keeps its own wording for the non-404 case.
export function fetcher(url: string, genericErrorMessage: string) {
  return fetch(url).then((res) => {
    if (!res.ok) {
      throw new Error(res.status === 404 ? "Session not found" : genericErrorMessage);
    }
    return res.json();
  });
}
