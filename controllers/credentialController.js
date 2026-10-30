import {
  deleteCredentialDocumentService,
  getMyCredentialDocumentService,
  getMyCredentialsService,
  submitCredentialsService,
  updateCredentialMetaService,
  uploadCredentialDocumentService,
} from '../services/credentials/credentialService.js';

const send = (res, result) => res.status(result.status).json(result.body);

function sendFile(res, result) {
  if (result.body || !result.file) {
    return res.status(result.status || 500).json(result.body || { success: false, message: 'Failed to load document' });
  }
  const { buffer, contentType, fileName, contentLength } = result.file;
  res.setHeader('Content-Type', contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${fileName || 'document'}"`);
  res.setHeader('Cache-Control', 'private, max-age=120');
  if (contentLength != null) res.setHeader('Content-Length', String(contentLength));
  return res.status(200).send(buffer);
}

export const getMyCredentials = async (req, res, next) => {
  try {
    send(res, await getMyCredentialsService(req.user));
  } catch (error) {
    next(error);
  }
};

export const patchCredentialMeta = async (req, res, next) => {
  try {
    send(res, await updateCredentialMetaService(req.user, req.body || {}));
  } catch (error) {
    next(error);
  }
};

export const uploadCredentialDocument = async (req, res, next) => {
  try {
    send(
      res,
      await uploadCredentialDocumentService(req.user, {
        type: req.body?.type,
        file: req.file,
      }),
    );
  } catch (error) {
    next(error);
  }
};

export const getCredentialDocument = async (req, res, next) => {
  try {
    return sendFile(res, await getMyCredentialDocumentService(req.user, req.params.docId));
  } catch (error) {
    next(error);
  }
};

export const deleteCredentialDocument = async (req, res, next) => {
  try {
    send(res, await deleteCredentialDocumentService(req.user, req.params.docId));
  } catch (error) {
    next(error);
  }
};

export const submitCredentials = async (req, res, next) => {
  try {
    send(res, await submitCredentialsService(req.user));
  } catch (error) {
    next(error);
  }
};
