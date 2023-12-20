FROM --platform=linux/amd64 node:20-slim

ENV PROJ_ROOT=code

RUN mkdir code/
ADD batch-processor-app/ ${PROJ_ROOT}

WORKDIR /${PROJ_ROOT}

# Create non-root user and only give permissions in user directory
RUN groupadd -g 999 appuser && useradd -r -u 999 -g appuser appuser
RUN chown -R appuser /${PROJ_ROOT}
RUN mkdir /home/appuser && chown -R appuser /home/appuser

USER appuser

