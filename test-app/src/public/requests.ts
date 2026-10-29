export type Request = { id: string; title: string; description: string; status: "open" | "closed" };
export function initialRequests(): Request[] {
  return [
    { id: "r-001", title: "Update team contact", description: "The support contact needs updating.", status: "open" },
    { id: "r-002", title: "Find monthly report", description: "Help locating the monthly report.", status: "closed" },
  ];
}
export function createRequest(requests: Request[], title: string, description: string): Request[] {
  if (!title.trim()) throw new Error("Enter a title.");
  let number = requests.length + 1;
  while (requests.some(request => request.id === `r-${String(number).padStart(3, "0")}`)) number++;
  return [...requests, { id: `r-${String(number).padStart(3, "0")}`, title: title.trim(), description: description.trim(), status: "open" }];
}
export function closeRequest(requests: Request[], id: string): Request[] {
  if (!requests.some(request => request.id === id)) throw new Error("Request not found.");
  return requests.map(request => request.id === id ? { ...request, status: "closed" } : request);
}
