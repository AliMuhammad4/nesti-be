import {
  deleteCredentialDocumentService,
  getMyCredentialDocumentService,
  getMyCredentialsService,
  submitCredentialsService,
  updateCredentialMetaService,
  uploadCredentialDocumentService,
} from '../services/credentials/credentialService.js';
import { sendStoredFile } from '../utils/fileResponse.js';

const send = (res, result) => res.status(result.status).json(result.body);

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
    return sendStoredFile(res, await getMyCredentialDocumentService(req.user, req.params.docId, { thumb: req.query?.thumb === '1' }));
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
