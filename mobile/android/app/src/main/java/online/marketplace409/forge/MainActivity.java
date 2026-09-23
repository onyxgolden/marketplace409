package online.marketplace409.forge;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins are not auto-discovered by Capacitor — register
        // the Call Shield bridge explicitly so the WebView can reach it.
        registerPlugin(CallShieldBridge.class);
        super.onCreate(savedInstanceState);
    }
}
