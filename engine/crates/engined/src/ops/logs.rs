//! Log directory envelopes, available before a character is attached.
use super::{error, reply, Outcome, World};
use protocol::generated::{
    DefineAck, ErrorCode, LogsListRequest, LogsListResult, LogsSetDirRequest, ReplyResult,
};

pub(super) fn set_dir(world: &World, request: LogsSetDirRequest) -> Outcome {
    world.set_log_dir(&request.params.dir);
    reply(
        request.id,
        ReplyResult::DefineAck(DefineAck {
            applied: true,
            count: None,
        }),
    )
}

pub(super) fn list(world: &World, request: LogsListRequest) -> Outcome {
    match world.list_logs() {
        Err(why) => error(request.id, ErrorCode::Unavailable, why),
        Ok((dir, found)) => reply(
            request.id,
            ReplyResult::LogsListResult(LogsListResult {
                dir,
                readable: found.readable,
                characters: found.characters,
            }),
        ),
    }
}
