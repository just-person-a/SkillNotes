const PREFIX = "";

const req = (url, options = {}) => {
  const { body } = options;

  return fetch(`${PREFIX}${url}`, {
    ...options,
    body: body ? JSON.stringify(body) : null,
    headers: {
      ...options.headers,
      ...(body
        ? {
          "Content-Type": "application/json",
        }
        : null),
    },
  }).then((res) =>
    res.ok
      ? res.json()
      : res.text().then((message) => {
        throw new Error(message);
      })
  );
};

export const getNotes = ({ age, search, page } = {}) => {
  const queryParams = new URLSearchParams();

  if (age) {
    queryParams.append('age', age);
  }

  if (search) {
    queryParams.append('search', search);
  }

  if (page) {
    queryParams.append('page', page);
  }

  return req(`/api/notes?${queryParams.toString()}`);
};

export const createNote = (title, text) => {
  return req('/api/notes', {
    method: 'POST',
    body: {
      title,
      text,
    },
  });
};

export const getNote = (id) => {
  return req(`/api/notes/${id}`);
};

export const archiveNote = (id) => {
  return req(`/api/notes/${id}`, {
    method: 'PATCH',
    body: {
      isArchived: true,
    },
  });
};

export const unarchiveNote = (id) => {
  return req(`/api/notes/${id}`, {
    method: 'PATCH',
    body: {
      isArchived: false,
    },
  });
};

export const editNote = (id, title, text) => {
  return req(`/api/notes/${id}`, {
    method: 'PATCH',
    body: {
      title,
      text,
    },
  });
};

export const deleteNote = (id) => {
  return req(`/api/notes/${id}`, {
    method: 'DELETE',
  });
};

export const deleteAllArchived = () => {
  return req('/api/notes', {
    method: 'DELETE',
  });
};

export const notePdfUrl = (id) => {
  return `/api/notes/${id}/pdf`;
};
