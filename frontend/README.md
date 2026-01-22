Front-end static scaffold (no framework)

How to use:

- Open `frontend/index.html` in your browser for login/register UI.
- Or serve the `frontend` folder with a static server (recommended):

  Python 3:

  ```bash
  cd frontend
  python -m http.server 8080
  # then open http://localhost:8080
  ```

  Or using `npx serve`:

  ```bash
  npx serve frontend -l 8080
  ```

Notes:
- The JS modules use the Axios ESM CDN. Ensure your browser supports ES modules.
- Update `frontend/js/axios.config.js` to point to your backend and python service, and set `x-api-key`.
- The scaffold demonstrates usage of all backend endpoints; complete UX flows (listings, IDs, error handling) can be implemented next.
