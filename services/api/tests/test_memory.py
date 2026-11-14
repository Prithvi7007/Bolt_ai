from bolt.memory import SessionStore

def test_reopen_session_and_list_turns(tmp_path):
    db = tmp_path / 'ledger.db'
    store = SessionStore(db)
    sid = store.create_session()
    store.append_turn(sid, 'user', 'Show revenue', None)
    store.append_turn(sid, 'assistant', 'Revenue is 42', {'metric':'revenue','dimension':'month','period':'2026','result_ref':'demo_1'})
    reopened = SessionStore(db)
    assert [t['role'] for t in reopened.list_turns(sid)] == ['user','assistant']
    assert reopened.context_snapshot(sid)['result_ref'] == 'demo_1'

def test_session_context_is_small_even_after_many_turns(tmp_path):
    store = SessionStore(tmp_path / 'state.db')
    sid = store.create_session()
    for i in range(300):
        store.append_turn(sid, 'user', f'irrelevant very long text {i} '+ 'X'*1000, None)
    store.append_turn(sid,'assistant','A',{'metric':'revenue','dimension':'channel','period':'2026','result_ref':'demo_2'})
    snapshot = store.context_snapshot(sid)
    assert len(str(snapshot)) < 300
    assert 'irrelevant' not in str(snapshot)
    assert len(store.list_turns(sid)) == 301

def test_no_memory_bleed_between_sessions(tmp_path):
    store = SessionStore(tmp_path / 'state.db')
    first = store.create_session()
    second = store.create_session()
    store.append_turn(first,'assistant','Result',{'metric':'revenue','dimension':'region','period':'2025','result_ref':'q'})
    assert store.context_snapshot(second) == {}
    assert store.list_turns(second) == []
    assert first != second
